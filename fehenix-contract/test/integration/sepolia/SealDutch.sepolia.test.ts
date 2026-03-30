import { expect } from "chai";
import hre from "hardhat";
import type { CofheClient } from "@cofhe/sdk";
import {
  confirmTransferFromReceipt,
  createClient,
  describeSepolia,
  dutchPrice,
  getSepoliaSigners,
  getContracts,
  getEventArgs,
  latestBlock,
  setShortOperator,
  uniqueBytes32
} from "./helpers.ts";

describeSepolia("SealDutch Sepolia", function () {
  this.timeout(30 * 60 * 1000);

  let creator: any;
  let bidder: any;
  let bidderClient: CofheClient;
  let sealDutch: any;
  let token: any;

  before(async function () {
    [creator, bidder] = await getSepoliaSigners(2);
    bidderClient = await createClient(bidder);

    const contracts = await getContracts();
    sealDutch = contracts.sealDutch;
    token = contracts.token;

    await (await token.mint(bidder.address, 25_000)).wait();
  });

  it("creates an auction, verifies the stake transfer, confirms acceptance, and emits AuctionEnded", async function () {
    const salt = uniqueBytes32("sepolia-dutch-salt");
    const auctionId = hre.ethers.keccak256(
      hre.ethers.solidityPacked(["address", "bytes32"], [creator.address, salt])
    );
    const acceptanceId = uniqueBytes32("sepolia-dutch-acceptance");
    const currentBlock = await latestBlock();
    const startBlock = currentBlock + 1;
    const endBlock = startBlock + 40;

    await (
      await sealDutch
        .connect(creator)
        .createAuction(auctionId, salt, uniqueBytes32("rfq"), 1_000, 600, 10, startBlock, endBlock)
    ).wait();

    await setShortOperator(token, bidder, await sealDutch.getAddress());

    const commitReceipt = await (
      await sealDutch.connect(bidder).commitAcceptance(auctionId, acceptanceId)
    ).wait();

    await confirmTransferFromReceipt(sealDutch, commitReceipt, bidderClient);

    const confirmReceipt = await (
      await sealDutch.connect(bidder).confirmAcceptance(auctionId, acceptanceId)
    ).wait();

    const ended = await getEventArgs(confirmReceipt, sealDutch, "AuctionEnded");
    const expectedPrice = dutchPrice({
      startPrice: 1_000,
      reservePrice: 600,
      priceDecrement: 10,
      startBlock,
      currentBlock: commitReceipt!.blockNumber
    });

    expect(ended.auctionId).to.equal(auctionId);
    expect(ended.winner).to.equal(bidder.address);
    expect(ended.finalPrice).to.equal(BigInt(expectedPrice));
  });
});
