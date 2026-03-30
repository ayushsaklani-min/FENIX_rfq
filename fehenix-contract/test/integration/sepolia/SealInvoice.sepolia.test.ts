import { expect } from "chai";
import hre from "hardhat";
import type { CofheClient } from "@cofhe/sdk";
import {
  confirmInvoicePendingPayment,
  confirmTransferFromReceipt,
  createClient,
  describeSepolia,
  getSepoliaSigners,
  getContracts,
  setShortOperator,
  uniqueBytes32
} from "./helpers.ts";

describeSepolia("SealInvoice Sepolia", function () {
  this.timeout(30 * 60 * 1000);

  let payer: any;
  let payee: any;
  let payerClient: CofheClient;
  let payeeClient: CofheClient;
  let sealInvoice: any;
  let token: any;

  before(async function () {
    [payer, payee] = await getSepoliaSigners(2);
    [payerClient, payeeClient] = await Promise.all([createClient(payer), createClient(payee)]);

    const contracts = await getContracts();
    sealInvoice = contracts.sealInvoice;
    token = contracts.token;

    await (await token.mint(payer.address, 50_000)).wait();
  });

  it("creates an invoice, pays it with FHERC20, confirms the encrypted payment, and withdraws it", async function () {
    const salt = uniqueBytes32("sepolia-invoice-salt");
    const amount = 12_500;
    const invoiceId = hre.ethers.keccak256(
      hre.ethers.solidityPacked(["address", "address", "uint256", "bytes32"], [payer.address, payee.address, amount, salt])
    );

    await (
      await sealInvoice
        .connect(payer)
        .createInvoice(
          invoiceId,
          salt,
          payee.address,
          await token.getAddress(),
          amount,
          hre.ethers.ZeroHash,
          uniqueBytes32("order"),
          "Sepolia integration invoice"
        )
    ).wait();

    await setShortOperator(token, payer, await sealInvoice.getAddress());

    const payReceipt = await (await sealInvoice.connect(payer).payInvoice(invoiceId)).wait();
    await confirmTransferFromReceipt(sealInvoice, payReceipt, payerClient);
    const paymentProof = await confirmInvoicePendingPayment(sealInvoice.connect(payer), invoiceId, payerClient);
    expect(paymentProof.decryptedValue).to.equal(BigInt(amount));

    const withdrawReceipt = await (await sealInvoice.connect(payee).withdrawPayment(invoiceId)).wait();
    const withdrawProof = await confirmTransferFromReceipt(sealInvoice, withdrawReceipt, payeeClient);
    expect(withdrawProof.proof.decryptedValue).to.equal(1n);

    const invoice = await sealInvoice.getInvoice(invoiceId);
    expect(invoice.status).to.equal(3n);
  });
});
