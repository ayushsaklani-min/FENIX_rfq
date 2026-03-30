import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import hre from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import type { CofheClient } from "@cofhe/sdk";

const require = createRequire(import.meta.url);
const { Ethers6Adapter } = require("@cofhe/sdk/adapters");
const { sepolia: cofheSepolia } = require("@cofhe/sdk/chains");
const { createCofheClient, createCofheConfig } = require("@cofhe/sdk/node");
const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia.publicnode.com";
const sepoliaProvider = new hre.ethers.JsonRpcProvider(sepoliaRpcUrl);

export type SepoliaDeployment = {
  network: string;
  chainId: number;
  deployer: string;
  confirmations: number;
  deployedAt: string;
  token: string;
  token1: string;
  token2: string;
  stakeToken: string;
  sealVickrey: string;
  sealDutch: string;
  sealInvoice: string;
  sealRFQ: string;
};

export const isSepoliaRun = hre.network.name === "eth-sepolia";
export const describeSepolia = isSepoliaRun ? describe : describe.skip;
const cachedEphemeralSigners: any[] = [];
const generatedEphemeralPrivateKeys: string[] = [];

export function loadDeployment(): SepoliaDeployment {
  const deploymentFile =
    process.env.SEPOLIA_DEPLOYMENT_FILE ??
    path.join(process.cwd(), "deployments", "eth-sepolia.json");

  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`Missing deployment file: ${deploymentFile}. Run scripts/deploy.ts on eth-sepolia first.`);
  }

  return JSON.parse(fs.readFileSync(deploymentFile, "utf8")) as SepoliaDeployment;
}

export async function getContracts() {
  const deployment = loadDeployment();

  const [token, token1, token2, sealVickrey, sealDutch, sealInvoice, sealRFQ] = await Promise.all([
    hre.ethers.getContractAt("MockFHERC20", deployment.token),
    hre.ethers.getContractAt("MockFHERC20", deployment.token1),
    hre.ethers.getContractAt("MockFHERC20", deployment.token2),
    hre.ethers.getContractAt("SealVickrey", deployment.sealVickrey),
    hre.ethers.getContractAt("SealDutch", deployment.sealDutch),
    hre.ethers.getContractAt("SealInvoice", deployment.sealInvoice),
    hre.ethers.getContractAt("SealRFQ", deployment.sealRFQ)
  ]);

  return {
    deployment,
    token,
    token1,
    token2,
    sealVickrey,
    sealDutch,
    sealInvoice,
    sealRFQ
  };
}

export async function createClient(signer: any): Promise<CofheClient> {
  const config = createCofheConfig({
    supportedChains: [cofheSepolia]
  });

  const client = createCofheClient(config);
  const provider = signer.provider ?? sepoliaProvider;
  const { publicClient, walletClient } = await Ethers6Adapter(provider, signer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();
  return client;
}

export async function getSepoliaSigners(count: number) {
  const configuredPrivateKey = process.env.PRIVATE_KEY;
  if (!configuredPrivateKey) {
    throw new Error("Missing PRIVATE_KEY for Sepolia integration runs.");
  }
  const funder = new hre.ethers.Wallet(configuredPrivateKey, sepoliaProvider);
  const signers = [funder];

  const topUpValue = hre.ethers.parseEther(process.env.SEPOLIA_TEST_SIGNER_ETH ?? "0.005");
  const minBalance = hre.ethers.parseEther(process.env.SEPOLIA_TEST_SIGNER_MIN_ETH ?? "0.003");

  async function ensureFunded(wallet: any) {
    const balance = await sepoliaProvider.getBalance(wallet.address);
    if (balance < minBalance) {
      await (await funder.sendTransaction({ to: wallet.address, value: topUpValue - balance })).wait();
    }
  }
  while (signers.length + cachedEphemeralSigners.length < count) {
    const nextIndex = cachedEphemeralSigners.length;
    if (!generatedEphemeralPrivateKeys[nextIndex]) {
      generatedEphemeralPrivateKeys[nextIndex] = hre.ethers.Wallet.createRandom().privateKey;
    }
    const privateKey = generatedEphemeralPrivateKeys[nextIndex];

    const wallet = new hre.ethers.Wallet(privateKey, sepoliaProvider);
    await ensureFunded(wallet);
    cachedEphemeralSigners.push(wallet);
  }

  return [...signers, ...cachedEphemeralSigners].slice(0, count);
}

export async function encryptUint64(client: CofheClient, value: bigint | number) {
  const [encrypted] = await client.encryptInputs([Encryptable.uint64(BigInt(value))]).execute();
  return encrypted;
}

export async function getEventArgs(receipt: any, contract: any, eventName: string) {
  const contractAddress = await contract.getAddress();

  for (const log of receipt.logs ?? []) {
    if (String(log.address).toLowerCase() !== String(contractAddress).toLowerCase()) {
      continue;
    }

    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === eventName) {
        return parsed.args;
      }
    } catch {
      continue;
    }
  }

  throw new Error(`Event ${eventName} not found`);
}

async function retryDecrypt<T>(action: () => Promise<T>): Promise<T> {
  const maxAttempts = Number(process.env.SEPOLIA_DECRYPT_ATTEMPTS ?? 12);
  const retryMs = Number(process.env.SEPOLIA_DECRYPT_RETRY_MS ?? 10000);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      const message = String((error as Error | undefined)?.message ?? error);
      const retryable = message.includes("HTTP 403") || message.includes("HTTP 404");
      if (!retryable || attempt === maxAttempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }

  throw lastError;
}

export async function confirmTransferFromReceipt(contract: any, receipt: any, client: CofheClient) {
  const args = await getEventArgs(receipt, contract, "TransferVerificationRequested");
  const proof = await retryDecrypt(() => client.decryptForTx(args.successCtHash).withPermit().execute());
  await (await contract.confirmTransferVerification(args.transferId, proof.decryptedValue === 1n, proof.signature)).wait();
  return {
    transferId: args.transferId,
    successCtHash: args.successCtHash,
    proof
  };
}

export async function confirmInvoicePendingPayment(sealInvoice: any, invoiceId: string, client: CofheClient) {
  const pendingCt = await sealInvoice.getPendingPayment(invoiceId);
  const proof = await retryDecrypt(() => client.decryptForTx(pendingCt).withPermit().execute());
  await (await sealInvoice.confirmInvoicePayment(invoiceId, proof.decryptedValue, proof.signature)).wait();
  return proof;
}

export async function decryptUint64ForView(client: CofheClient, ctHash: string) {
  return retryDecrypt(() => client.decryptForView(ctHash, FheTypes.Uint64).withPermit().execute());
}

export async function decryptUint64ForTx(client: CofheClient, ctHash: string, usePermit = true) {
  const builder = client.decryptForTx(ctHash);
  return retryDecrypt(() => (usePermit ? builder.withPermit().execute() : builder.withoutPermit().execute()));
}

export async function latestBlock(): Promise<number> {
  return hre.ethers.provider.getBlockNumber();
}

export async function waitForBlock(targetBlock: number) {
  const pollMs = Number(process.env.SEPOLIA_BLOCK_POLL_MS ?? 15000);
  const timeoutMs = Number(process.env.SEPOLIA_BLOCK_WAIT_TIMEOUT_MS ?? 4 * 60 * 60 * 1000);
  const logEvery = Number(process.env.SEPOLIA_BLOCK_LOG_EVERY ?? 4);
  const started = Date.now();
  const startingBlock = await latestBlock();
  let polls = 0;

  console.log(
    `[sepolia-wait] waiting for block ${targetBlock} from ${startingBlock} (${Math.max(
      targetBlock - startingBlock,
      0
    )} blocks remaining)`
  );

  while ((await latestBlock()) < targetBlock) {
    polls++;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for block ${targetBlock}`);
    }

    const current = await latestBlock();
    const remaining = Math.max(targetBlock - current, 0);
    if (polls === 1 || polls % logEvery === 0) {
      const elapsedMs = Date.now() - started;
      const progressed = Math.max(current - startingBlock, 0);
      const avgMsPerBlock = progressed > 0 ? elapsedMs / progressed : 12000;
      const etaMinutes = Math.ceil((remaining * avgMsPerBlock) / 60000);
      console.log(
        `[sepolia-wait] current=${current} target=${targetBlock} remaining=${remaining} eta≈${etaMinutes}m`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  console.log(`[sepolia-wait] reached block ${targetBlock}`);
}

export async function setShortOperator(token: any, signer: any, operator: string) {
  const latest = await hre.ethers.provider.getBlock("latest");
  await (await token.connect(signer).setOperator(operator, BigInt(Number(latest?.timestamp ?? 0) + 600))).wait();
}

export function uniqueBytes32(label: string) {
  return hre.ethers.id(`${label}-${Date.now()}-${Math.random()}`);
}

export function toAddressFromBigInt(value: bigint) {
  return hre.ethers.getAddress(hre.ethers.toBeHex(value, 20));
}

export function dutchPrice({
  startPrice,
  reservePrice,
  priceDecrement,
  startBlock,
  currentBlock
}: {
  startPrice: number;
  reservePrice: number;
  priceDecrement: number;
  startBlock: number;
  currentBlock: number;
}) {
  if (currentBlock < startBlock) {
    return startPrice;
  }

  const blocksElapsed = currentBlock - startBlock;
  const totalDecrement = blocksElapsed * priceDecrement;
  const maxDecrement = startPrice - reservePrice;
  if (totalDecrement > maxDecrement) {
    return reservePrice;
  }

  return startPrice - totalDecrement;
}
