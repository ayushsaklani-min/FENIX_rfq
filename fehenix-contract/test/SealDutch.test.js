const hre = require("hardhat");
const { expect } = require("chai");
const {
  createClient,
  dutchPrice,
  getEventArgs,
  confirmTransferFromReceipt,
  latestBlock,
  mineBlocks
} = require("./helpers/cofhe");

describe("SealDutch", function () {
  const DEFAULT_STAKE = 10_000n;

  let creator;
  let bidder;
  let other;
  let creatorClient;
  let bidderClient;
  let token;
  let sealDutch;
  let callbackProbe;

  async function setOperatorFor(account, operatorAddress) {
    const block = await hre.ethers.provider.getBlock("latest");
    await token.connect(account).setOperator(operatorAddress, BigInt(block.timestamp + 600));
  }

  async function createAuctionFixture() {
    const salt = hre.ethers.id(`dutch-salt-${Math.random()}`);
    const auctionId = hre.ethers.keccak256(
      hre.ethers.solidityPacked(["address", "bytes32"], [creator.address, salt])
    );
    const startPrice = 1_000;
    const reservePrice = 600;
    const priceDecrement = 10;
    const startBlock = (await latestBlock()) + 2;
    const endBlock = startBlock + 60;

    await (
      await sealDutch
        .connect(creator)
        .createAuction(
          auctionId,
          salt,
          hre.ethers.id("rfq-dutch"),
          startPrice,
          reservePrice,
          priceDecrement,
          startBlock,
          endBlock
        )
    ).wait();

    await mineBlocks(2);

    return {
      auctionId,
      startPrice,
      reservePrice,
      priceDecrement,
      startBlock,
      endBlock
    };
  }

  beforeEach(async function () {
    [creator, bidder, other] = await hre.ethers.getSigners();
    [creatorClient, bidderClient] = await Promise.all([createClient(creator), createClient(bidder)]);

    token = await hre.ethers.deployContract("MockFHERC20");
    sealDutch = await hre.ethers.deployContract("SealDutch", [await token.getAddress()]);
    callbackProbe = await hre.ethers.deployContract("MockCallbackProbe");

    await Promise.all([
      (await token.mint(bidder.address, 200_000)).wait(),
      (await token.mint(other.address, 200_000)).wait(),
      (await token.mint(creator.address, 50_000)).wait()
    ]);
  });

  it("creates an auction, commits an acceptance, verifies the transfer, confirms the acceptance, and refunds stake", async function () {
    const fixture = await createAuctionFixture();
    const acceptanceId = hre.ethers.id("acceptance-1");

    await setOperatorFor(bidder, await sealDutch.getAddress());

    const commitReceipt = await (
      await sealDutch.connect(bidder).commitAcceptance(fixture.auctionId, acceptanceId)
    ).wait();

    await confirmTransferFromReceipt(sealDutch, commitReceipt, bidderClient);

    const acceptance = await sealDutch.getAcceptance(fixture.auctionId, acceptanceId);
    expect(acceptance.bidder).to.equal(bidder.address);
    expect(acceptance.stake).to.equal(DEFAULT_STAKE);

    await (await sealDutch.connect(bidder).confirmAcceptance(fixture.auctionId, acceptanceId)).wait();

    const result = await sealDutch.getAuctionResult(fixture.auctionId);
    const expectedPrice = dutchPrice({
      startPrice: fixture.startPrice,
      reservePrice: fixture.reservePrice,
      priceDecrement: fixture.priceDecrement,
      startBlock: fixture.startBlock,
      currentBlock: commitReceipt.blockNumber
    });
    expect(result.winner).to.equal(bidder.address);
    expect(result.finalized).to.equal(true);
    expect(result.finalPrice).to.equal(BigInt(expectedPrice));

    const refundReceipt = await (
      await sealDutch.connect(bidder).refundStake(fixture.auctionId, acceptanceId)
    ).wait();
    await confirmTransferFromReceipt(sealDutch, refundReceipt, bidderClient);

    await hre.cofhe.mocks.expectPlaintext(await token.confidentialBalanceOf(bidder.address), 200_000n);
    await hre.cofhe.mocks.expectPlaintext(await token.confidentialBalanceOf(await sealDutch.getAddress()), 0n);
  });

  it("supports the direct acceptPrice path after transfer verification", async function () {
    const fixture = await createAuctionFixture();

    await setOperatorFor(bidder, await sealDutch.getAddress());

    const acceptReceipt = await (await sealDutch.connect(bidder).acceptPrice(fixture.auctionId)).wait();
    await confirmTransferFromReceipt(sealDutch, acceptReceipt, bidderClient);

    const auction = await sealDutch.getAuction(fixture.auctionId);
    const expectedPrice = dutchPrice({
      startPrice: fixture.startPrice,
      reservePrice: fixture.reservePrice,
      priceDecrement: fixture.priceDecrement,
      startBlock: fixture.startBlock,
      currentBlock: acceptReceipt.blockNumber
    });

    expect(auction.winner).to.equal(bidder.address);
    expect(auction.finalPrice).to.equal(BigInt(expectedPrice));
    expect(auction.status).to.equal(3n);
  });

  it("resets an expired commitment back to active when the confirmation window passes", async function () {
    const fixture = await createAuctionFixture();
    const acceptanceId = hre.ethers.id("acceptance-expired");

    await setOperatorFor(bidder, await sealDutch.getAddress());

    const commitReceipt = await (
      await sealDutch.connect(bidder).commitAcceptance(fixture.auctionId, acceptanceId)
    ).wait();
    await confirmTransferFromReceipt(sealDutch, commitReceipt, bidderClient);

    await mineBlocks(11);
    await (await sealDutch.connect(creator).resetExpiredCommitment(fixture.auctionId, acceptanceId)).wait();

    const auction = await sealDutch.getAuction(fixture.auctionId);
    expect(auction.status).to.equal(1n);
    expect(await sealDutch.hasAlreadyAccepted(fixture.auctionId, bidder.address)).to.equal(false);
  });

  it("slashes an unconfirmed bidder stake after the confirmation window", async function () {
    const fixture = await createAuctionFixture();
    const acceptanceId = hre.ethers.id("acceptance-slashed");

    await setOperatorFor(bidder, await sealDutch.getAddress());

    const commitReceipt = await (
      await sealDutch.connect(bidder).commitAcceptance(fixture.auctionId, acceptanceId)
    ).wait();
    await confirmTransferFromReceipt(sealDutch, commitReceipt, bidderClient);

    await mineBlocks(11);
    const slashReceipt = await (
      await sealDutch.connect(creator).slashNonConfirmed(fixture.auctionId, acceptanceId)
    ).wait();
    await confirmTransferFromReceipt(sealDutch, slashReceipt, creatorClient);

    const acceptance = await sealDutch.getAcceptance(fixture.auctionId, acceptanceId);
    expect(acceptance.stake).to.equal(0n);
    expect(acceptance.slashed).to.equal(true);
    await hre.cofhe.mocks.expectPlaintext(await token.confidentialBalanceOf(creator.address), 60_000n);
  });

  it("rejects callback calls with wrong token, wrong operator, and malformed data", async function () {
    const fixture = await createAuctionFixture();
    const acceptanceId = hre.ethers.id("acceptance-callback");
    const validData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32"],
      [fixture.auctionId, acceptanceId]
    );

    const wrongTokenReceipt = await (
      await callbackProbe.callReceiver(
        await sealDutch.getAddress(),
        await sealDutch.getAddress(),
        bidder.address,
        hre.ethers.ZeroHash,
        validData
      )
    ).wait();
    const wrongTokenDecision = await getEventArgs(wrongTokenReceipt, callbackProbe, "CallbackDecision");
    await hre.cofhe.mocks.expectPlaintext(wrongTokenDecision.decisionCtHash, 0n);

    const wrongOperatorReceipt = await (
      await token.simulateCallback(
        await sealDutch.getAddress(),
        other.address,
        bidder.address,
        hre.ethers.ZeroHash,
        validData
      )
    ).wait();
    const wrongOperatorDecision = await getEventArgs(wrongOperatorReceipt, token, "SimulatedCallback");
    await hre.cofhe.mocks.expectPlaintext(wrongOperatorDecision.decisionCtHash, 0n);

    const malformedDataReceipt = await (
      await token.simulateCallback(
        await sealDutch.getAddress(),
        await sealDutch.getAddress(),
        bidder.address,
        hre.ethers.ZeroHash,
        "0x1234"
      )
    ).wait();
    const malformedDataDecision = await getEventArgs(malformedDataReceipt, token, "SimulatedCallback");
    await hre.cofhe.mocks.expectPlaintext(malformedDataDecision.decisionCtHash, 0n);
  });
});
