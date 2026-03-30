const hre = require("hardhat");

async function main() {
  const token1Address = process.env.TOKEN1_ADDRESS || hre.ethers.ZeroAddress;
  const token2Address = process.env.TOKEN2_ADDRESS || hre.ethers.ZeroAddress;
  const stakeTokenAddress = process.env.STAKE_TOKEN_ADDRESS || token1Address;

  if (stakeTokenAddress === hre.ethers.ZeroAddress) {
    throw new Error("Set STAKE_TOKEN_ADDRESS or TOKEN1_ADDRESS before deploying");
  }

  console.log("🚀 Starting deployment to", hre.network.name);
  console.log("=".repeat(50));

  const [deployer] = await hre.ethers.getSigners();
  console.log("📝 Deploying contracts with account:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", hre.ethers.formatEther(balance), "ETH");
  console.log("=".repeat(50));

  // Deploy SealVickrey
  console.log("\n📦 Deploying SealVickrey...");
  const SealVickrey = await hre.ethers.getContractFactory("SealVickrey");
  const sealVickrey = await SealVickrey.deploy(stakeTokenAddress);
  await sealVickrey.waitForDeployment();
  const sealVickreyAddress = await sealVickrey.getAddress();
  console.log("✅ SealVickrey deployed to:", sealVickreyAddress);

  // Deploy SealDutch
  console.log("\n📦 Deploying SealDutch...");
  const SealDutch = await hre.ethers.getContractFactory("SealDutch");
  const sealDutch = await SealDutch.deploy(stakeTokenAddress);
  await sealDutch.waitForDeployment();
  const sealDutchAddress = await sealDutch.getAddress();
  console.log("✅ SealDutch deployed to:", sealDutchAddress);

  // Deploy SealRFQ using deployer as admin and token addresses from env.
  console.log("\n📦 Deploying SealRFQ...");
  const SealRFQ = await hre.ethers.getContractFactory("SealRFQ");
  const sealRFQ = await SealRFQ.deploy(
    deployer.address, // admin
    token1Address,
    token2Address
  );
  await sealRFQ.waitForDeployment();
  const sealRFQAddress = await sealRFQ.getAddress();
  console.log("✅ SealRFQ deployed to:", sealRFQAddress);

  // Deploy SealInvoice (requires SealRFQ address)
  console.log("\n📦 Deploying SealInvoice...");
  const SealInvoice = await hre.ethers.getContractFactory("SealInvoice");
  const sealInvoice = await SealInvoice.deploy(sealRFQAddress);
  await sealInvoice.waitForDeployment();
  const sealInvoiceAddress = await sealInvoice.getAddress();
  console.log("✅ SealInvoice deployed to:", sealInvoiceAddress);

  console.log("\n🔗 Wiring SealInvoice into SealRFQ...");
  const setInvoiceTx = await sealRFQ.setSealInvoiceAddress(sealInvoiceAddress);
  await setInvoiceTx.wait();
  console.log("✅ SealInvoice linked in SealRFQ");

  console.log("\n" + "=".repeat(50));
  console.log("🎉 All contracts deployed successfully!");
  console.log("=".repeat(50));
  console.log("\n📋 Deployment Summary:");
  console.log("├─ SealVickrey: ", sealVickreyAddress);
  console.log("├─ SealDutch:   ", sealDutchAddress);
  console.log("├─ SealRFQ:     ", sealRFQAddress);
  console.log("└─ SealInvoice: ", sealInvoiceAddress);
  console.log("\n📋 Runtime Config:");
  console.log("├─ stakeToken: ", stakeTokenAddress);
  console.log("├─ token1: ", token1Address);
  console.log("└─ token2: ", token2Address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
