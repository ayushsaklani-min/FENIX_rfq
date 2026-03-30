const hre = require("hardhat");
const { expect } = require("chai");
const {
  createClient,
  decryptUint64ForTx,
  getEventArgs,
  confirmTransferFromReceipt
} = require("./helpers/cofhe");

describe("SealInvoice", function () {
  let payer;
  let payee;
  let other;
  let payerClient;
  let payeeClient;
  let token;
  let sealInvoice;
  let callbackProbe;

  async function setOperatorFor(account, operatorAddress) {
    const block = await hre.ethers.provider.getBlock("latest");
    await token.connect(account).setOperator(operatorAddress, BigInt(block.timestamp + 600));
  }

  async function createInvoiceFixture({ tokenAddress, amount, rfqId = hre.ethers.ZeroHash }) {
    const salt = hre.ethers.id(`invoice-salt-${Math.random()}`);
    const invoiceId = hre.ethers.keccak256(
      hre.ethers.solidityPacked(
        ["address", "address", "uint256", "bytes32"],
        [payer.address, payee.address, amount, salt]
      )
    );

    await (
      await sealInvoice
        .connect(payer)
        .createInvoice(
          invoiceId,
          salt,
          payee.address,
          tokenAddress,
          amount,
          rfqId,
          hre.ethers.id("order-1"),
          "invoice description"
        )
    ).wait();

    return { invoiceId, amount };
  }

  async function confirmInvoicePendingPayment(invoiceId) {
    const pendingCt = await sealInvoice.getPendingPayment(invoiceId);
    const proof = await decryptUint64ForTx(payerClient, pendingCt, true);
    await (
      await sealInvoice.connect(payer).confirmInvoicePayment(invoiceId, proof.decryptedValue, proof.signature)
    ).wait();
    return proof;
  }

  beforeEach(async function () {
    [payer, payee, other] = await hre.ethers.getSigners();
    [payerClient, payeeClient] = await Promise.all([createClient(payer), createClient(payee)]);

    token = await hre.ethers.deployContract("MockFHERC20");
    sealInvoice = await hre.ethers.deployContract("SealInvoice", [hre.ethers.ZeroAddress]);
    callbackProbe = await hre.ethers.deployContract("MockCallbackProbe");

    await Promise.all([
      (await token.mint(payer.address, 250_000)).wait(),
      (await token.mint(payee.address, 5_000)).wait()
    ]);
  });

  it("creates an FHERC20 invoice, pays it through confidentialTransferFromAndCall, confirms the payment, and withdraws it", async function () {
    const { invoiceId, amount } = await createInvoiceFixture({
      tokenAddress: await token.getAddress(),
      amount: 25_000
    });

    await setOperatorFor(payer, await sealInvoice.getAddress());

    const payReceipt = await (await sealInvoice.connect(payer).payInvoice(invoiceId)).wait();
    await confirmTransferFromReceipt(sealInvoice, payReceipt, payerClient);
    await confirmInvoicePendingPayment(invoiceId);

    const receipt = await sealInvoice.getReceiptForInvoice(invoiceId);
    expect(receipt.invoiceId).to.equal(invoiceId);
    expect(receipt.amount).to.equal(BigInt(amount));

    const withdrawReceipt = await (await sealInvoice.connect(payee).withdrawPayment(invoiceId)).wait();
    await confirmTransferFromReceipt(sealInvoice, withdrawReceipt, payeeClient);

    const invoice = await sealInvoice.getInvoice(invoiceId);
    expect(invoice.status).to.equal(3n);
    await hre.cofhe.mocks.expectPlaintext(await token.confidentialBalanceOf(payee.address), 30_000n);
  });

  it("supports the native invoice payment and withdraw path", async function () {
    const { invoiceId, amount } = await createInvoiceFixture({
      tokenAddress: hre.ethers.ZeroAddress,
      amount: 2_000
    });

    await (
      await sealInvoice.connect(payer).payInvoiceNative(invoiceId, {
        value: amount
      })
    ).wait();

    await (await sealInvoice.connect(payee).withdrawPaymentNative(invoiceId)).wait();

    const invoice = await sealInvoice.getInvoice(invoiceId);
    expect(invoice.status).to.equal(3n);
    expect(await hre.ethers.provider.getBalance(await sealInvoice.getAddress())).to.equal(0n);
  });

  it("refunds an FHERC20 invoice back to the payer", async function () {
    const { invoiceId } = await createInvoiceFixture({
      tokenAddress: await token.getAddress(),
      amount: 40_000
    });

    await setOperatorFor(payer, await sealInvoice.getAddress());

    const payReceipt = await (await sealInvoice.connect(payer).payInvoice(invoiceId)).wait();
    await confirmTransferFromReceipt(sealInvoice, payReceipt, payerClient);
    await confirmInvoicePendingPayment(invoiceId);

    const refundReceipt = await (await sealInvoice.connect(payee).refundInvoice(invoiceId)).wait();
    await confirmTransferFromReceipt(sealInvoice, refundReceipt, payerClient);

    const invoice = await sealInvoice.getInvoice(invoiceId);
    expect(invoice.status).to.equal(5n);
    await hre.cofhe.mocks.expectPlaintext(await token.confidentialBalanceOf(payer.address), 250_000n);
  });

  it("emits the direct payment flow after transfer verification", async function () {
    const paymentId = hre.ethers.id("direct-payment");

    await setOperatorFor(payer, await sealInvoice.getAddress());

    const paymentReceipt = await (
      await sealInvoice.connect(payer).directPayment(paymentId, payee.address, await token.getAddress(), 15_000)
    ).wait();

    const transfer = await confirmTransferFromReceipt(sealInvoice, paymentReceipt, payerClient);
    expect(transfer.proof.decryptedValue).to.equal(1n);
    await hre.cofhe.mocks.expectPlaintext(await token.confidentialBalanceOf(payee.address), 20_000n);
  });

  it("rejects callback calls with wrong token, wrong operator, and malformed data", async function () {
    const { invoiceId } = await createInvoiceFixture({
      tokenAddress: await token.getAddress(),
      amount: 1_000
    });
    const validData = hre.ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [invoiceId]);

    const wrongTokenReceipt = await (
      await callbackProbe.callReceiver(
        await sealInvoice.getAddress(),
        await sealInvoice.getAddress(),
        payer.address,
        hre.ethers.ZeroHash,
        validData
      )
    ).wait();
    const wrongTokenDecision = await getEventArgs(wrongTokenReceipt, callbackProbe, "CallbackDecision");
    await hre.cofhe.mocks.expectPlaintext(wrongTokenDecision.decisionCtHash, 0n);

    const wrongOperatorReceipt = await (
      await token.simulateCallback(
        await sealInvoice.getAddress(),
        other.address,
        payer.address,
        hre.ethers.ZeroHash,
        validData
      )
    ).wait();
    const wrongOperatorDecision = await getEventArgs(wrongOperatorReceipt, token, "SimulatedCallback");
    await hre.cofhe.mocks.expectPlaintext(wrongOperatorDecision.decisionCtHash, 0n);

    const malformedDataReceipt = await (
      await token.simulateCallback(
        await sealInvoice.getAddress(),
        await sealInvoice.getAddress(),
        payer.address,
        hre.ethers.ZeroHash,
        "0x1234"
      )
    ).wait();
    const malformedDataDecision = await getEventArgs(malformedDataReceipt, token, "SimulatedCallback");
    await hre.cofhe.mocks.expectPlaintext(malformedDataDecision.decisionCtHash, 0n);
  });
});
