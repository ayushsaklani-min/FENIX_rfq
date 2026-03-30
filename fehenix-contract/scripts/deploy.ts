import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";

type DeploymentRecord = {
  network: string;
  chainId: number;
  deployer: string;
  confirmations: number;
  deployedAt: string;
  tokenImplementation: string;
  token: string;
  token1: string;
  token2: string;
  stakeToken: string;
  sealVickrey: string;
  sealDutch: string;
  sealInvoice: string;
  sealRFQ: string;
};

async function waitForTx(txPromise: Promise<any>, confirmations: number, label: string) {
  const receipt = await (await txPromise).wait(confirmations);
  console.log(`${label}: ${receipt?.hash}`);
}

async function deployContract(name: string, args: any[], confirmations: number, overrides?: Record<string, any>) {
  const factory = await hre.ethers.getContractFactory(name);
  const contract = await factory.deploy(...args, ...(overrides ? [overrides] : []));
  await contract.waitForDeployment();

  const deploymentTx = contract.deploymentTransaction();
  if (deploymentTx) {
    await deploymentTx.wait(confirmations);
  }

  const address = await contract.getAddress();
  console.log(`${name}: ${address}`);
  return contract;
}

function writeDeployment(record: DeploymentRecord) {
  const deploymentsDir = path.join(process.cwd(), "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const filePath = path.join(deploymentsDir, `${record.network}.json`);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
  console.log(`Deployment file: ${filePath}`);
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const networkName = hre.network.name;
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const confirmations = Number(process.env.DEPLOY_CONFIRMATIONS ?? (networkName === "eth-sepolia" ? 2 : 1));
  const deployGasLimit = BigInt(process.env.DEPLOY_GAS_LIMIT ?? (networkName === "eth-sepolia" ? "15000000" : "12000000"));
  const forceDeployToken = process.env.FORCE_DEPLOY_TOKEN === "true";
  const tokenName = process.env.FHERC20_TOKEN_NAME ?? "SEAL Confidential Token";
  const tokenSymbol = process.env.FHERC20_TOKEN_SYMBOL ?? "eSEAL";
  const tokenDecimals = Number(process.env.FHERC20_TOKEN_DECIMALS ?? "4");
  const tokenInitialSupply = BigInt(process.env.FHERC20_INITIAL_SUPPLY ?? "2000000");

  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 18) {
    throw new Error("FHERC20_TOKEN_DECIMALS must be an integer between 0 and 18.");
  }
  if (tokenInitialSupply < 0n || tokenInitialSupply > BigInt("18446744073709551615")) {
    throw new Error("FHERC20_INITIAL_SUPPLY must fit in uint64.");
  }

  if (networkName === "hardhat") {
    await hre.cofhe.mocks.deployMocks({ deployTestBed: true, silent: true });
  }

  console.log(`Deploying to ${networkName} with: ${deployer.address}`);
  console.log(`Chain ID: ${chainId}`);
  console.log(`Confirmations: ${confirmations}`);
  console.log(`Deploy gas limit: ${deployGasLimit.toString()}`);

  const deployOverrides = networkName === "eth-sepolia" ? { gasLimit: deployGasLimit } : undefined;

  let stakeTokenAddress = process.env.STAKE_TOKEN_ADDRESS;
  let token1Address = process.env.TOKEN1_ADDRESS;
  let token2Address = process.env.TOKEN2_ADDRESS;
  let tokenImplementation = process.env.TOKEN_IMPLEMENTATION ?? "external";

  if (forceDeployToken || (!stakeTokenAddress && !token1Address)) {
    console.log("Deploying FHERC20Permit demo token...");
    const token = await deployContract(
      "SealDemoFHERC20Permit",
      [
        tokenName,
        tokenSymbol,
        tokenDecimals,
        deployer.address,
        deployer.address,
        tokenInitialSupply.toString(),
      ],
      confirmations,
      deployOverrides
    );
    const tokenAddress = await token.getAddress();
    tokenImplementation = "SealDemoFHERC20Permit";
    stakeTokenAddress = tokenAddress;
    token1Address = tokenAddress;
    token2Address = tokenAddress;
  } else {
    stakeTokenAddress = stakeTokenAddress ?? token1Address!;
    token1Address = token1Address ?? stakeTokenAddress;
    token2Address = token2Address ?? token1Address;
  }

  if (!stakeTokenAddress || !token1Address || !token2Address) {
    throw new Error("Token configuration failed. Set STAKE_TOKEN_ADDRESS/TOKEN1_ADDRESS/TOKEN2_ADDRESS or deploy without overrides.");
  }

  console.log(`stakeToken/token1: ${stakeTokenAddress}`);
  console.log(`token2: ${token2Address}`);

  console.log("Deploying SealVickrey...");
  const sealVickrey = await deployContract("SealVickrey", [stakeTokenAddress], confirmations, deployOverrides);

  console.log("Deploying SealDutch...");
  const sealDutch = await deployContract("SealDutch", [stakeTokenAddress], confirmations, deployOverrides);

  console.log("Deploying SealInvoice with placeholder SealRFQ address...");
  const sealInvoice = await deployContract("SealInvoice", [hre.ethers.ZeroAddress], confirmations, deployOverrides);

  console.log("Deploying SealRFQ...");
  const sealRFQ = await deployContract("SealRFQ", [deployer.address, token1Address, token2Address], confirmations, deployOverrides);

  console.log("Configuring trusted auction sources...");
  await waitForTx(
    sealRFQ.setTrustedAuction(await sealVickrey.getAddress(), true),
    confirmations,
    "SealRFQ.setTrustedAuction(SealVickrey)"
  );
  await waitForTx(
    sealRFQ.setTrustedAuction(await sealDutch.getAddress(), true),
    confirmations,
    "SealRFQ.setTrustedAuction(SealDutch)"
  );

  console.log("Configuring SealInvoice <-> SealRFQ linkage...");
  await waitForTx(
    sealRFQ.setSealInvoiceAddress(await sealInvoice.getAddress()),
    confirmations,
    "SealRFQ.setSealInvoiceAddress"
  );
  await waitForTx(
    sealInvoice.setSealRFQAddress(await sealRFQ.getAddress()),
    confirmations,
    "SealInvoice.setSealRFQAddress"
  );

  const record: DeploymentRecord = {
    network: networkName,
    chainId,
    deployer: deployer.address,
    confirmations,
    deployedAt: new Date().toISOString(),
    tokenImplementation,
    token: stakeTokenAddress,
    token1: token1Address,
    token2: token2Address,
    stakeToken: stakeTokenAddress,
    sealVickrey: await sealVickrey.getAddress(),
    sealDutch: await sealDutch.getAddress(),
    sealInvoice: await sealInvoice.getAddress(),
    sealRFQ: await sealRFQ.getAddress()
  };

  writeDeployment(record);

  console.log("Deployment summary:");
  console.log(JSON.stringify(record, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
