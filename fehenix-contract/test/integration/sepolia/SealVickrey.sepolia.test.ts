import { expect } from "chai";
import hre from "hardhat";
import type { CofheClient } from "@cofhe/sdk";
import {
  confirmTransferFromReceipt,
  createClient,
  decryptUint64ForTx,
  describeSepolia,
  encryptUint64,
  getSepoliaSigners,
  getContracts,
  latestBlock,
  setShortOperator,
  toAddressFromBigInt,
  uniqueBytes32,
  waitForBlock
} from "./helpers.ts";

describeSepolia("SealVickrey Sepolia", function () {
  this.timeout(45 * 60 * 1000);

  let creator: any;
  let bidder: any;
  let creatorClient: CofheClient;
  let bidderClient: CofheClient;
  let sealVickrey: any;
  let token: any;

  before(async function () {
    [creator, bidder] = await getSepoliaSigners(2);
    [creatorClient, bidderClient] = await Promise.all([createClient(creator), createClient(bidder)]);

    const contracts = await getContracts();
    sealVickrey = contracts.sealVickrey;
    token = contracts.token;

    await (await token.mint(bidder.address, 30_000)).wait();
  });

  it("creates an auction, commits a bid, reveals it, and finalizes the second-price outcome", async function () {
    const salt = uniqueBytes32("sepolia-vickrey-salt");
    const auctionId = hre.ethers.keccak256(
      hre.ethers.solidityPacked(["address", "bytes32"], [creator.address, salt])
    );
    const bidId = uniqueBytes32("sepolia-vickrey-bid");
    const currentBlock = await latestBlock();
    const biddingDeadline = currentBlock + 25;
    const revealDeadline = biddingDeadline + 20;

    await (
      await sealVickrey
        .connect(creator)
        .createAuction(auctionId, salt, uniqueBytes32("rfq"), biddingDeadline, revealDeadline, 10_000, 1)
    ).wait();

    await setShortOperator(token, bidder, await sealVickrey.getAddress());
    const encryptedBid = await encryptUint64(bidderClient, 125);

    const commitReceipt = await (
      await sealVickrey.connect(bidder).commitBid(auctionId, bidId, encryptedBid)
    ).wait();
    await confirmTransferFromReceipt(sealVickrey, commitReceipt, bidderClient);

    await waitForBlock(biddingDeadline);
    await (await sealVickrey.connect(creator).closeBidding(auctionId)).wait();

    const revealProof = await decryptUint64ForTx(bidderClient, (await sealVickrey.bids(auctionId, bidId)).encryptedAmount, true);
    await (
      await sealVickrey.connect(bidder).revealBid(auctionId, bidId, revealProof.decryptedValue, revealProof.signature)
    ).wait();

    await waitForBlock(revealDeadline);

    const lowestProof = await decryptUint64ForTx(creatorClient, await sealVickrey.encryptedLowestBid(auctionId), true);
    const secondProof = await decryptUint64ForTx(creatorClient, await sealVickrey.encryptedSecondLowestBid(auctionId), true);
    const winnerProof = await creatorClient.decryptForTx(await sealVickrey.encryptedLowestBidder(auctionId)).withPermit().execute();

    await (
      await sealVickrey
        .connect(creator)
        .finalizeAuction(
          auctionId,
          lowestProof.decryptedValue,
          lowestProof.signature,
          secondProof.decryptedValue,
          secondProof.signature,
          toAddressFromBigInt(winnerProof.decryptedValue),
          winnerProof.signature
        )
    ).wait();

    const result = await sealVickrey.getAuctionResult(auctionId);
    expect(result.winner).to.equal(bidder.address);
    expect(result.finalized).to.equal(true);
    expect(result.finalPrice).to.equal(125n);
  });
});
