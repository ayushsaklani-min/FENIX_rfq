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
  encryptUint64,
  toAddressFromBigInt
} = require("./helpers/cofhe");

describe("SealVickrey", function () {
  let creator;
  let vendor1;
  let vendor2;
  let other;
  let creatorClient;
  let vendor1Client;
  let vendor2Client;
  let token;
  let sealVickrey;
  let callbackProbe;

  async function setOperatorFor(account, operatorAddress) {
    const block = await hre.ethers.provider.getBlock("latest");
    await token.connect(account).setOperator(operatorAddress, BigInt(block.timestamp + 600));
  }

  async function createAuctionFixture(minBidCount = 2) {
    const salt = hre.ethers.id(`vickrey-salt-${Math.random()}`);
    const auctionId = hre.ethers.keccak256(
      hre.ethers.solidityPacked(["address", "bytes32"], [creator.address, salt])
    );
    const biddingDeadline = (await latestBlock()) + 20;
    const revealDeadline = biddingDeadline + 20;

    await (
      await sealVickrey
        .connect(creator)
        .createAuction(
          auctionId,
          salt,
          hre.ethers.id("rfq-vickrey"),
          biddingDeadline,
          revealDeadline,
          10_000,
          minBidCount
        )
    ).wait();

    return { auctionId, biddingDeadline, revealDeadline };
  }

  async function revealBidAs(bidder, bidderClient, auctionId, bidId) {
    const bid = await sealVickrey.bids(auctionId, bidId);
    const proof = await decryptUint64ForTx(bidderClient, bid.encryptedAmount, true);
    await (await sealVickrey.connect(bidder).revealBid(auctionId, bidId, proof.decryptedValue, proof.signature)).wait();
    return proof;
  }

  beforeEach(async function () {
    [creator, vendor1, vendor2, other] = await hre.ethers.getSigners();
    [creatorClient, vendor1Client, vendor2Client] = await Promise.all([
      createClient(creator),
      createClient(vendor1),
      createClient(vendor2)
    ]);

    token = await hre.ethers.deployContract("MockFHERC20");
    sealVickrey = await hre.ethers.deployContract("SealVickrey", [await token.getAddress()]);
    callbackProbe = await hre.ethers.deployContract("MockCallbackProbe");

    await Promise.all([
      (await token.mint(vendor1.address, 200_000)).wait(),
      (await token.mint(vendor2.address, 200_000)).wait(),
      (await token.mint(creator.address, 25_000)).wait()
    ]);
  });

  it("commits encrypted bids, finalizes the second-price outcome, and refunds both stakes", async function () {
    const { auctionId, biddingDeadline, revealDeadline } = await createAuctionFixture(2);
    const bidId1 = hre.ethers.id("vickrey-bid-1");
    const bidId2 = hre.ethers.id("vickrey-bid-2");

    await Promise.all([
      setOperatorFor(vendor1, await sealVickrey.getAddress()),
      setOperatorFor(vendor2, await sealVickrey.getAddress())
    ]);

    const encryptedBid1 = await encryptUint64(vendor1Client, 100);
    const encryptedBid2 = await encryptUint64(vendor2Client, 150);

    const commitReceipt1 = await (
      await sealVickrey.connect(vendor1).commitBid(auctionId, bidId1, encryptedBid1)
    ).wait();
    await confirmTransferFromReceipt(sealVickrey, commitReceipt1, vendor1Client);

    const commitReceipt2 = await (
      await sealVickrey.connect(vendor2).commitBid(auctionId, bidId2, encryptedBid2)
    ).wait();
    await confirmTransferFromReceipt(sealVickrey, commitReceipt2, vendor2Client);

    const bid1 = await sealVickrey.bids(auctionId, bidId1);
    const bid2 = await sealVickrey.bids(auctionId, bidId2);
    expect(await decryptUint64ForView(vendor1Client, bid1.encryptedAmount)).to.equal(100n);
    expect(await decryptUint64ForView(vendor2Client, bid2.encryptedAmount)).to.equal(150n);
    await hre.cofhe.mocks.expectPlaintext(await sealVickrey.encryptedLowestBid(auctionId), 100n);
    await hre.cofhe.mocks.expectPlaintext(await sealVickrey.encryptedSecondLowestBid(auctionId), 150n);

    await mineBlocks(biddingDeadline - (await latestBlock()));
    await (await sealVickrey.connect(creator).closeBidding(auctionId)).wait();

    await revealBidAs(vendor1, vendor1Client, auctionId, bidId1);
    await revealBidAs(vendor2, vendor2Client, auctionId, bidId2);

    await mineBlocks(revealDeadline - (await latestBlock()));

    const lowestProof = await decryptUint64ForTx(creatorClient, await sealVickrey.encryptedLowestBid(auctionId), false);
    const secondProof = await decryptUint64ForTx(
      creatorClient,
      await sealVickrey.encryptedSecondLowestBid(auctionId),
      false
    );
    const winnerProof = await creatorClient
      .decryptForTx(await sealVickrey.encryptedLowestBidder(auctionId))
      .withoutPermit()
      .execute();

    await (
      await sealVickrey.connect(creator).finalizeAuction(
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
    expect(result.winner).to.equal(vendor1.address);
    expect(result.finalized).to.equal(true);
    expect(result.finalPrice).to.equal(150n);

    const refundReceipt1 = await (await sealVickrey.connect(vendor1).refundStake(auctionId, bidId1)).wait();
    await confirmTransferFromReceipt(sealVickrey, refundReceipt1, vendor1Client);
    const refundReceipt2 = await (await sealVickrey.connect(vendor2).refundStake(auctionId, bidId2)).wait();
    await confirmTransferFromReceipt(sealVickrey, refundReceipt2, vendor2Client);

    await hre.cofhe.mocks.expectPlaintext(await token.confidentialBalanceOf(vendor1.address), 200_000n);
    await hre.cofhe.mocks.expectPlaintext(await token.confidentialBalanceOf(vendor2.address), 200_000n);
  });

  it("slashes an unrevealed bid after the reveal deadline", async function () {
    const { auctionId, biddingDeadline, revealDeadline } = await createAuctionFixture(1);
    const bidId = hre.ethers.id("unrevealed-bid");
    const encryptedBid = await encryptUint64(vendor1Client, 210);

    await setOperatorFor(vendor1, await sealVickrey.getAddress());

    const commitReceipt = await (
      await sealVickrey.connect(vendor1).commitBid(auctionId, bidId, encryptedBid)
    ).wait();
    await confirmTransferFromReceipt(sealVickrey, commitReceipt, vendor1Client);

    await mineBlocks(biddingDeadline - (await latestBlock()));
    await (await sealVickrey.connect(creator).closeBidding(auctionId)).wait();
    await mineBlocks(revealDeadline - (await latestBlock()) + 1);

    const slashReceipt = await (await sealVickrey.connect(creator).slashUnrevealed(auctionId, bidId)).wait();
    await confirmTransferFromReceipt(sealVickrey, slashReceipt, creatorClient);

    const bid = await sealVickrey.getBidInfo(auctionId, bidId);
    expect(bid.stake).to.equal(0n);
    await hre.cofhe.mocks.expectPlaintext(await token.confidentialBalanceOf(creator.address), 35_000n);
  });

  it("rejects callback calls with wrong token, wrong operator, and malformed data", async function () {
    const { auctionId } = await createAuctionFixture(1);
    const bidId = hre.ethers.id("callback-bid");
    const validData = hre.ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [auctionId, bidId]);

    const wrongTokenReceipt = await (
      await callbackProbe.callReceiver(
        await sealVickrey.getAddress(),
        await sealVickrey.getAddress(),
        vendor1.address,
        hre.ethers.ZeroHash,
        validData
      )
    ).wait();
    const wrongTokenDecision = await getEventArgs(wrongTokenReceipt, callbackProbe, "CallbackDecision");
    await hre.cofhe.mocks.expectPlaintext(wrongTokenDecision.decisionCtHash, 0n);

    const wrongOperatorReceipt = await (
      await token.simulateCallback(
        await sealVickrey.getAddress(),
        other.address,
        vendor1.address,
        hre.ethers.ZeroHash,
        validData
      )
    ).wait();
    const wrongOperatorDecision = await getEventArgs(wrongOperatorReceipt, token, "SimulatedCallback");
    await hre.cofhe.mocks.expectPlaintext(wrongOperatorDecision.decisionCtHash, 0n);

    const malformedDataReceipt = await (
      await token.simulateCallback(
        await sealVickrey.getAddress(),
        await sealVickrey.getAddress(),
        vendor1.address,
        hre.ethers.ZeroHash,
        "0x1234"
      )
    ).wait();
    const malformedDataDecision = await getEventArgs(malformedDataReceipt, token, "SimulatedCallback");
    await hre.cofhe.mocks.expectPlaintext(malformedDataDecision.decisionCtHash, 0n);
  });
});
