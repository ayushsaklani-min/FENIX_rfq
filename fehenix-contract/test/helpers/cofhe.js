const hre = require("hardhat");
const { Encryptable, FheTypes } = require("@cofhe/sdk");

async function createClient(signer) {
  return hre.cofhe.createClientWithBatteries(signer);
}

async function encryptUint64(client, value) {
  const [encrypted] = await client.encryptInputs([Encryptable.uint64(BigInt(value))]).execute();
  return encrypted;
}

async function mineBlocks(count) {
  if (count <= 0) {
    return;
  }

  await hre.network.provider.send("hardhat_mine", [hre.ethers.toQuantity(count)]);
}

async function latestBlock() {
  return hre.ethers.provider.getBlockNumber();
}

async function getEventArgs(receipt, contract, eventName) {
  const contractAddress = await contract.getAddress();

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
      continue;
    }

    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === eventName) {
        return parsed.args;
      }
    } catch (_) {
      continue;
    }
  }

  throw new Error(`Event ${eventName} not found`);
}

async function confirmTransferFromReceipt(contract, receipt, client) {
  const args = await getEventArgs(receipt, contract, "TransferVerificationRequested");
  const proof = await client.decryptForTx(args.successCtHash).withoutPermit().execute();
  const tx = await contract.confirmTransferVerification(
    args.transferId,
    proof.decryptedValue === 1n,
    proof.signature
  );
  await tx.wait();
  return {
    transferId: args.transferId,
    successCtHash: args.successCtHash,
    proof
  };
}

async function getTransferRequestFromReceipt(contract, receipt) {
  const args = await getEventArgs(receipt, contract, "TransferVerificationRequested");
  return {
    transferId: args.transferId,
    successCtHash: args.successCtHash
  };
}

async function decryptUint64ForView(client, ctHash) {
  return client.decryptForView(ctHash, FheTypes.Uint64).execute();
}

async function decryptUint64ForTx(client, ctHash, usePermit = true) {
  const builder = client.decryptForTx(ctHash);
  return usePermit ? builder.withPermit().execute() : builder.withoutPermit().execute();
}

function toAddressFromBigInt(value) {
  return hre.ethers.getAddress(hre.ethers.toBeHex(value, 20));
}

function dutchPrice({ startPrice, reservePrice, priceDecrement, startBlock, currentBlock }) {
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

module.exports = {
  createClient,
  decryptUint64ForTx,
  decryptUint64ForView,
  dutchPrice,
  encryptUint64,
  getEventArgs,
  getTransferRequestFromReceipt,
  latestBlock,
  mineBlocks,
  confirmTransferFromReceipt,
  toAddressFromBigInt
};
