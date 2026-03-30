const hre = require("hardhat");
const { expect } = require("chai");
const {
  createClient,
  decryptUint64ForTx,
  decryptUint64ForView,
  getEventArgs,
  confirmTransferFromReceipt,
  latestBlock,
  mineBlocks,
  encryptUint64
} = require("./helpers/cofhe");

describe("SealRFQ", function () {
  const TOKEN1 = 0;
  const MODE_STANDARD = 0;
  const MODE_VICKREY = 1;

  let admin;
  let creator;
  let vendor1;
  let vendor2;
  let other;
  let creatorClient;
  let vendor1Client;
  let vendor2Client;
  let token1;
  let token2;
  let sealRFQ;
  let callbackProbe;
  let auctionSource;

  async function setOperatorFor(token, account, operatorAddress) {
    const block = await hre.ethers.provider.getBlock("latest");
    await token.connect(account).setOperator(operatorAddress, BigInt(block.timestamp + 600));
  }

  async function createRfqFixture({
    minBid = 100,
    minBidCount = 2,
    mode = MODE_STANDARD
  } = {}) {
    const salt = hre.ethers.id(`rfq-salt-${Math.random()}`);
    const rfqId = hre.ethers.keccak256(
      hre.ethers.solidityPacked(["address", "bytes32"], [creator.address, salt])
    );
    const biddingDeadline = (await latestBlock()) + 50;
    const revealDeadline = biddingDeadline + 720;

    await (
      await sealRFQ
        .connect(creator)
        .createRFQ(
          rfqId,
          salt,
          biddingDeadline,
          revealDeadline,
          minBid,
          minBidCount,
          hre.ethers.id("rfq-metadata"),
          TOKEN1,
          mode
        )
    ).wait();

    return { rfqId, biddingDeadline, revealDeadline, minBid };
  }

  async function submitBidAndVerify(bidder, bidderClient, rfqId, bidId, amount) {
    const encryptedBid = await encryptUint64(bidderClient, amount);
    const receipt = await (await sealRFQ.connect(bidder).submitBid(rfqId, bidId, encryptedBid)).wait();
    await confirmTransferFromReceipt(sealRFQ, receipt, bidderClient);
    return encryptedBid;
  }

  async function moveToReveal(rfqId, biddingDeadline) {
    await mineBlocks(biddingDeadline - (await latestBlock()));
    await (await sealRFQ.connect(creator).closeBidding(rfqId)).wait();
  }

  async function publishLowestBid(rfqId) {
    const lowestCt = await sealRFQ.lowestEncryptedBid(rfqId);
    const proof = await decryptUint64ForTx(creatorClient, lowestCt, false);
    await (await sealRFQ.connect(creator).publishLowestBid(rfqId, proof.decryptedValue, proof.signature)).wait();
    return proof;
  }

  async function selectWinnerFromBid(rfqId, bidId, bidderClient) {
    const bid = await sealRFQ.bids(rfqId, bidId);
    const proof = await decryptUint64ForTx(bidderClient, bid.encryptedAmount, true);
    await (await sealRFQ.connect(creator).selectWinner(rfqId, bidId, proof.decryptedValue, proof.signature)).wait();
    return proof;
  }

  beforeEach(async function () {
    [admin, creator, vendor1, vendor2, other] = await hre.ethers.getSigners();
    [creatorClient, vendor1Client, vendor2Client] = await Promise.all([
      createClient(creator),
      createClient(vendor1),
      createClient(vendor2)
    ]);

    token1 = await hre.ethers.deployContract("MockFHERC20");
    token2 = await hre.ethers.deployContract("MockFHERC20");
    sealRFQ = await hre.ethers.deployContract("SealRFQ", [
      admin.address,
      await token1.getAddress(),
      await token2.getAddress()
    ]);
    callbackProbe = await hre.ethers.deployContract("MockCallbackProbe");
    auctionSource = await hre.ethers.deployContract("MockAuctionResultSource");

    await (await sealRFQ.connect(admin).configurePlatform(0, false)).wait();

    await Promise.all([
      (await token1.mint(creator.address, 500_000)).wait(),
      (await token1.mint(vendor1.address, 250_000)).wait(),
      (await token1.mint(vendor2.address, 250_000)).wait(),
      (await token2.mint(creator.address, 500_000)).wait()
    ]);
  });

  it("runs the full RFQ happy path from encrypted bidding through escrow release", async function () {
    const { rfqId, biddingDeadline, revealDeadline } = await createRfqFixture();
    const bidId1 = hre.ethers.id("rfq-bid-1");
    const bidId2 = hre.ethers.id("rfq-bid-2");

    await Promise.all([
      setOperatorFor(token1, vendor1, await sealRFQ.getAddress()),
      setOperatorFor(token1, vendor2, await sealRFQ.getAddress())
    ]);

    await submitBidAndVerify(vendor1, vendor1Client, rfqId, bidId1, 130);
    await submitBidAndVerify(vendor2, vendor2Client, rfqId, bidId2, 110);

    const bid2 = await sealRFQ.bids(rfqId, bidId2);
    expect(await decryptUint64ForView(vendor2Client, bid2.encryptedAmount)).to.equal(110n);
    await hre.cofhe.mocks.expectPlaintext(await sealRFQ.lowestEncryptedBid(rfqId), 110n);

    await moveToReveal(rfqId, biddingDeadline);
    await publishLowestBid(rfqId);

    await mineBlocks(revealDeadline - (await latestBlock()));
    await selectWinnerFromBid(rfqId, bidId2, vendor2Client);

    const winnerState = await sealRFQ.getRFQ(rfqId);
    expect(winnerState.winnerAddress).to.equal(vendor2.address);
    expect(winnerState.status).to.equal(3n);

    const winnerResponseReceipt = await (await sealRFQ.connect(vendor2).winnerRespond(rfqId, true)).wait();
    await confirmTransferFromReceipt(sealRFQ, winnerResponseReceipt, vendor2Client);

    await setOperatorFor(token1, creator, await sealRFQ.getAddress());
    const escrowReceipt = await (await sealRFQ.connect(creator).fundEscrowToken(rfqId, TOKEN1, 110)).wait();
    await confirmTransferFromReceipt(sealRFQ, escrowReceipt, creatorClient);

    const releaseReceipt = await (await sealRFQ.connect(creator).releasePartialPayment(rfqId, 50)).wait();
    await confirmTransferFromReceipt(sealRFQ, releaseReceipt, vendor2Client);

    const escrow = await sealRFQ.getEscrow(rfqId);
    expect(escrow.originalAmount).to.equal(110n);
    expect(escrow.currentAmount).to.equal(55n);
    expect(escrow.totalReleased).to.equal(55n);
    await hre.cofhe.mocks.expectPlaintext(await token1.confidentialBalanceOf(vendor2.address), 250_055n);
  });

  it("imports a trusted auction result", async function () {
    const { rfqId } = await createRfqFixture({ mode: MODE_VICKREY, minBidCount: 1 });
    const auctionId = hre.ethers.id("imported-auction");

    await (await sealRFQ.connect(admin).setTrustedAuction(await auctionSource.getAddress(), true)).wait();
    await (await auctionSource.setResult(auctionId, vendor1.address, 125, true)).wait();

    await (
      await sealRFQ.connect(creator).importAuctionResult(rfqId, auctionId, await auctionSource.getAddress(), 1)
    ).wait();

    const rfq = await sealRFQ.getRFQ(rfqId);
    expect(rfq.winnerAddress).to.equal(vendor1.address);
    expect(rfq.status).to.equal(3n);
    expect(await sealRFQ.winnerBids(rfqId)).to.not.equal(hre.ethers.ZeroHash);
  });

  it("refunds a losing bidder stake after the winner rejects", async function () {
    const { rfqId, biddingDeadline, revealDeadline } = await createRfqFixture();
    const loserBidId = hre.ethers.id("loser-bid");
    const winnerBidId = hre.ethers.id("winner-bid");

    await Promise.all([
      setOperatorFor(token1, vendor1, await sealRFQ.getAddress()),
      setOperatorFor(token1, vendor2, await sealRFQ.getAddress())
    ]);

    await submitBidAndVerify(vendor1, vendor1Client, rfqId, loserBidId, 140);
    await submitBidAndVerify(vendor2, vendor2Client, rfqId, winnerBidId, 120);

    await moveToReveal(rfqId, biddingDeadline);
    await publishLowestBid(rfqId);
    await mineBlocks(revealDeadline - (await latestBlock()));
    await selectWinnerFromBid(rfqId, winnerBidId, vendor2Client);

    const rejectReceipt = await (await sealRFQ.connect(vendor2).winnerRespond(rfqId, false)).wait();
    await confirmTransferFromReceipt(sealRFQ, rejectReceipt, creatorClient);

    await mineBlocks(1441);
    const refundReceipt = await (await sealRFQ.connect(vendor1).refundStake(rfqId, loserBidId)).wait();
    await confirmTransferFromReceipt(sealRFQ, refundReceipt, vendor1Client);

    await hre.cofhe.mocks.expectPlaintext(await token1.confidentialBalanceOf(vendor1.address), 250_000n);
  });

  it("slashes a winner who never responds", async function () {
    const { rfqId, biddingDeadline, revealDeadline } = await createRfqFixture({ minBidCount: 1 });
    const bidId = hre.ethers.id("non-responder");

    await setOperatorFor(token1, vendor1, await sealRFQ.getAddress());
    await submitBidAndVerify(vendor1, vendor1Client, rfqId, bidId, 115);

    await moveToReveal(rfqId, biddingDeadline);
    await publishLowestBid(rfqId);
    await mineBlocks(revealDeadline - (await latestBlock()));
    await selectWinnerFromBid(rfqId, bidId, vendor1Client);

    await mineBlocks(2161);
    const slashReceipt = await (await sealRFQ.connect(creator).slashNonRevealer(rfqId, bidId)).wait();
    await confirmTransferFromReceipt(sealRFQ, slashReceipt, creatorClient);

    await hre.cofhe.mocks.expectPlaintext(await token1.confidentialBalanceOf(creator.address), 500_010n);
  });

  it("supports cancellation types 0 through 4", async function () {
    const cancel3 = await createRfqFixture({ minBidCount: 1 });
    await (await sealRFQ.connect(creator).cancelRFQ(cancel3.rfqId, 3)).wait();
    expect((await sealRFQ.getRFQ(cancel3.rfqId)).status).to.equal(6n);

    const cancel0 = await createRfqFixture({ minBidCount: 2 });
    await mineBlocks(cancel0.biddingDeadline - (await latestBlock()) + 1);
    await (await sealRFQ.connect(creator).cancelRFQ(cancel0.rfqId, 0)).wait();
    expect((await sealRFQ.getRFQ(cancel0.rfqId)).status).to.equal(6n);

    const cancel1 = await createRfqFixture({ minBidCount: 1 });
    await setOperatorFor(token1, vendor1, await sealRFQ.getAddress());
    await submitBidAndVerify(vendor1, vendor1Client, cancel1.rfqId, hre.ethers.id("cancel1-bid"), 150);
    await moveToReveal(cancel1.rfqId, cancel1.biddingDeadline);
    await mineBlocks(cancel1.revealDeadline - (await latestBlock()) + 1441);
    await (await sealRFQ.connect(creator).cancelRFQ(cancel1.rfqId, 1)).wait();
    expect((await sealRFQ.getRFQ(cancel1.rfqId)).status).to.equal(6n);

    const cancel2 = await createRfqFixture({ minBidCount: 1 });
    const cancel2Bid = hre.ethers.id("cancel2-bid");
    await setOperatorFor(token1, vendor1, await sealRFQ.getAddress());
    await submitBidAndVerify(vendor1, vendor1Client, cancel2.rfqId, cancel2Bid, 130);
    await moveToReveal(cancel2.rfqId, cancel2.biddingDeadline);
    await publishLowestBid(cancel2.rfqId);
    await mineBlocks(cancel2.revealDeadline - (await latestBlock()));
    await selectWinnerFromBid(cancel2.rfqId, cancel2Bid, vendor1Client);
    await mineBlocks(2161);
    await (await sealRFQ.connect(creator).cancelRFQ(cancel2.rfqId, 2)).wait();
    expect((await sealRFQ.getRFQ(cancel2.rfqId)).status).to.equal(6n);

    const cancel4 = await createRfqFixture({ minBidCount: 1 });
    await setOperatorFor(token1, vendor1, await sealRFQ.getAddress());
    await submitBidAndVerify(vendor1, vendor1Client, cancel4.rfqId, hre.ethers.id("cancel4-bid"), 160);
    await mineBlocks(cancel4.biddingDeadline - (await latestBlock()) + 1541);
    await (await sealRFQ.connect(other).cancelRFQ(cancel4.rfqId, 4)).wait();
    expect((await sealRFQ.getRFQ(cancel4.rfqId)).status).to.equal(6n);
  });

  it("rejects callback calls with wrong token, wrong operator, and malformed data", async function () {
    const { rfqId } = await createRfqFixture({ minBidCount: 1 });
    const bidId = hre.ethers.id("rfq-callback");
    const validData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "bytes32", "bytes32", "uint64"],
      [0, rfqId, bidId, 10]
    );

    const wrongTokenReceipt = await (
      await callbackProbe.callReceiver(
        await sealRFQ.getAddress(),
        await sealRFQ.getAddress(),
        vendor1.address,
        hre.ethers.ZeroHash,
        validData
      )
    ).wait();
    const wrongTokenDecision = await getEventArgs(wrongTokenReceipt, callbackProbe, "CallbackDecision");
    await hre.cofhe.mocks.expectPlaintext(wrongTokenDecision.decisionCtHash, 0n);

    const wrongOperatorReceipt = await (
      await token1.simulateCallback(
        await sealRFQ.getAddress(),
        other.address,
        vendor1.address,
        hre.ethers.ZeroHash,
        validData
      )
    ).wait();
    const wrongOperatorDecision = await getEventArgs(wrongOperatorReceipt, token1, "SimulatedCallback");
    await hre.cofhe.mocks.expectPlaintext(wrongOperatorDecision.decisionCtHash, 0n);

    const malformedDataReceipt = await (
      await token1.simulateCallback(
        await sealRFQ.getAddress(),
        await sealRFQ.getAddress(),
        vendor1.address,
        hre.ethers.ZeroHash,
        "0x1234"
      )
    ).wait();
    const malformedDataDecision = await getEventArgs(malformedDataReceipt, token1, "SimulatedCallback");
    await hre.cofhe.mocks.expectPlaintext(malformedDataDecision.decisionCtHash, 0n);
  });
});
