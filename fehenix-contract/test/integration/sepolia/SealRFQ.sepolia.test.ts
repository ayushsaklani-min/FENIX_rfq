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
  uniqueBytes32,
  waitForBlock
} from "./helpers.ts";

describeSepolia("SealRFQ Sepolia", function () {
  this.timeout(6 * 60 * 60 * 1000);

  let admin: any;
  let creator: any;
  let bidder: any;
  let creatorClient: CofheClient;
  let bidderClient: CofheClient;
  let sealRFQ: any;
  let token1: any;

  before(async function () {
    [admin, creator, bidder] = await getSepoliaSigners(3);
    [creatorClient, bidderClient] = await Promise.all([createClient(creator), createClient(bidder)]);

    const contracts = await getContracts();
    sealRFQ = contracts.sealRFQ;
    token1 = contracts.token1;

    await (await token1.mint(creator.address, 100_000)).wait();
    await (await token1.mint(bidder.address, 50_000)).wait();
  });

  it("runs the long-form RFQ flow on Sepolia", async function () {
    const salt = uniqueBytes32("sepolia-rfq-salt");
    const rfqId = hre.ethers.keccak256(
      hre.ethers.solidityPacked(["address", "bytes32"], [creator.address, salt])
    );
    const bidId = uniqueBytes32("sepolia-rfq-bid");
    const currentBlock = await latestBlock();
    const biddingDeadline = currentBlock + 60;
    const revealDeadline = biddingDeadline + 720;

    await (
      await sealRFQ
        .connect(creator)
        .createRFQ(
          rfqId,
          salt,
          biddingDeadline,
          revealDeadline,
          100,
          1,
          uniqueBytes32("metadata"),
          0,
          0
        )
    ).wait();

    await setShortOperator(token1, bidder, await sealRFQ.getAddress());
    const encryptedBid = await encryptUint64(bidderClient, 110);

    const submitReceipt = await (
      await sealRFQ.connect(bidder).submitBid(rfqId, bidId, encryptedBid)
    ).wait();
    await confirmTransferFromReceipt(sealRFQ, submitReceipt, bidderClient);

    const liveRfqAfterBid = await sealRFQ.getRFQ(rfqId);
    await waitForBlock(Number(liveRfqAfterBid.biddingDeadline));
    await (await sealRFQ.connect(creator).closeBidding(rfqId)).wait();

    const lowestProof = await decryptUint64ForTx(creatorClient, await sealRFQ.lowestEncryptedBid(rfqId), true);
    await (
      await sealRFQ.connect(creator).publishLowestBid(rfqId, lowestProof.decryptedValue, lowestProof.signature)
    ).wait();

    const liveRfqAfterClose = await sealRFQ.getRFQ(rfqId);
    await waitForBlock(Number(liveRfqAfterClose.revealDeadline));
    const winnerProof = await decryptUint64ForTx(bidderClient, (await sealRFQ.bids(rfqId, bidId)).encryptedAmount, true);
    await (
      await sealRFQ.connect(creator).selectWinner(rfqId, bidId, winnerProof.decryptedValue, winnerProof.signature)
    ).wait();

    const respondReceipt = await (await sealRFQ.connect(bidder).winnerRespond(rfqId, true)).wait();
    await confirmTransferFromReceipt(sealRFQ, respondReceipt, bidderClient);

    await setShortOperator(token1, creator, await sealRFQ.getAddress());
    const escrowReceipt = await (await sealRFQ.connect(creator).fundEscrowToken(rfqId, 0, 110)).wait();
    await confirmTransferFromReceipt(sealRFQ, escrowReceipt, creatorClient);

    const releaseReceipt = await (await sealRFQ.connect(creator).releasePartialPayment(rfqId, 100)).wait();
    await confirmTransferFromReceipt(sealRFQ, releaseReceipt, bidderClient);

    const rfq = await sealRFQ.getRFQ(rfqId);
    expect(rfq.status).to.equal(5n);
    expect(rfq.finalPaymentReleased).to.equal(true);
  });
});
