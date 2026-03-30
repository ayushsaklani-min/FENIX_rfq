import { NextRequest, NextResponse } from 'next/server';
import { keccak256, solidityPacked } from 'ethers';
import { z } from 'zod';
import { requireRole } from '../../../auth/middleware';
import { getFhenixClients } from '../../../lib/fhenixClient';
import {
    addressSchema,
    bytes32Schema,
    hexBytesRegex,
    u64StringSchema,
} from '../../../lib/fhenixProtocol';

const uint256LikeSchema = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]);
const permitSchema = z.object({
    deadline: uint256LikeSchema,
    v: z.number().int().min(0).max(255),
    r: z.string().regex(hexBytesRegex, 'r must be hex bytes'),
    s: z.string().regex(hexBytesRegex, 's must be hex bytes'),
});

const INVOICE_STATUS_LABELS: Record<number, string> = {
    0: 'NONE',
    1: 'PENDING',
    2: 'PAID',
    3: 'COMPLETED',
    4: 'CANCELLED',
    5: 'REFUNDED',
};

const CreateInvoiceSchema = z.object({
    invoiceId: bytes32Schema.optional(),
    salt: bytes32Schema,
    payee: addressSchema,
    token: addressSchema.optional(),
    amount: z.string().regex(/^\d+$/),
    rfqId: bytes32Schema.optional(),
    orderId: bytes32Schema.optional(),
    description: z.string().max(1000),
    txHash: z.string().optional(),
});

const PayInvoiceSchema = z.object({
    isNative: z.boolean().optional(),
    permit: permitSchema.optional(),
    txHash: z.string().optional(),
});

const ConfirmInvoicePaymentSchema = z.object({
    plaintext: u64StringSchema,
    signature: z.string().regex(hexBytesRegex, 'signature must be hex bytes'),
    txHash: z.string().optional(),
});

const CancelInvoiceSchema = z.object({
    reason: z.string().max(500),
    txHash: z.string().optional(),
});

const ConfirmTransferSchema = z.object({
    transferId: bytes32Schema,
    success: z.boolean(),
    signature: z.string().regex(hexBytesRegex, 'signature must be hex bytes'),
    txHash: z.string().optional(),
});

function badRequest(message: string) {
    return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message } }, { status: 400 });
}

function serverError(message: string) {
    return NextResponse.json({ status: 'error', error: { code: 'SERVER_ERROR', message } }, { status: 500 });
}

function toUint256(value: number | string): bigint {
    return typeof value === 'number' ? BigInt(value) : BigInt(value);
}

function getPermitArgs(permit: z.infer<typeof permitSchema>) {
    return [toUint256(permit.deadline), permit.v, permit.r, permit.s] as const;
}

function deriveInvoiceId(payer: string, payee: string, amount: string, salt: string): string {
    return keccak256(solidityPacked(['address', 'address', 'uint256', 'bytes32'], [payer, payee, BigInt(amount), salt]));
}

async function buildTxRequest(to: string, data: string, value: bigint | number = 0n) {
    const { chainId } = getFhenixClients();
    return {
        to,
        data,
        value: BigInt(value).toString(),
        chainId,
    };
}

export async function handleInvoiceCreate(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = CreateInvoiceSchema.parse(await request.json());
        const { sealInvoice } = getFhenixClients();

        const derivedInvoiceId = deriveInvoiceId(auth.walletAddress, data.payee, data.amount, data.salt);
        if (data.invoiceId && data.invoiceId.toLowerCase() !== derivedInvoiceId.toLowerCase()) {
            return badRequest('Supplied invoiceId does not match keccak256(payer, payee, amount, salt).');
        }

        const token = data.token ?? '0x0000000000000000000000000000000000000000';
        const rfqId = data.rfqId ?? '0x' + '0'.repeat(64);
        const orderId = data.orderId ?? '0x' + '0'.repeat(64);

        if (!data.txHash) {
            const tx = await sealInvoice.createInvoice.populateTransaction(
                derivedInvoiceId,
                data.salt,
                data.payee,
                token,
                BigInt(data.amount),
                rfqId,
                orderId,
                data.description,
            );
            return NextResponse.json({
                status: 'success',
                data: {
                    invoiceId: derivedInvoiceId,
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        return NextResponse.json({ status: 'success', data: { invoiceId: derivedInvoiceId, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleInvoiceGet(request: NextRequest, invoiceId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(invoiceId).success) {
        return badRequest('Invalid invoiceId format.');
    }

    try {
        const { sealInvoice } = getFhenixClients();
        const invoice = await sealInvoice.getInvoice(invoiceId);
        const payer = String(invoice.payer);

        if (payer === '0x0000000000000000000000000000000000000000') {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'Invoice not found' } },
                { status: 404 },
            );
        }

        return NextResponse.json({
            status: 'success',
            data: {
                invoiceId: String(invoice.invoiceId),
                payer,
                payee: String(invoice.payee),
                token: String(invoice.token),
                amount: BigInt(invoice.amount).toString(),
                rfqId: String(invoice.rfqId),
                orderId: String(invoice.orderId),
                statusCode: Number(invoice.status),
                status: INVOICE_STATUS_LABELS[Number(invoice.status)] ?? 'UNKNOWN',
                createdAt: Number(invoice.createdAt),
                paidAt: Number(invoice.paidAt),
                descriptionHash: String(invoice.descriptionHash),
            },
        });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch invoice');
    }
}

export async function handleInvoicePay(request: NextRequest, invoiceId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(invoiceId).success) {
        return badRequest('Invalid invoiceId format.');
    }

    try {
        const data = PayInvoiceSchema.parse(await request.json().catch(() => ({})));
        const { sealInvoice } = getFhenixClients();
        const invoice = await sealInvoice.getInvoice(invoiceId);
        const isNative = data.isNative ?? (String(invoice.token) === '0x0000000000000000000000000000000000000000');
        const amount = BigInt(invoice.amount);

        if (!data.txHash) {
            const tx = isNative
                ? await sealInvoice.payInvoiceNative.populateTransaction(invoiceId, { value: amount })
                : data.permit
                  ? await sealInvoice.permitAndPayInvoice.populateTransaction(invoiceId, ...getPermitArgs(data.permit))
                  : await sealInvoice.payInvoice.populateTransaction(invoiceId);

            return NextResponse.json({
                status: 'success',
                data: {
                    invoiceId,
                    amount: amount.toString(),
                    isNative,
                    usesPermit: !isNative && Boolean(data.permit),
                    tx: await buildTxRequest(tx.to as string, tx.data as string, isNative ? amount : 0n),
                },
            });
        }

        return NextResponse.json({ status: 'success', data: { invoiceId, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleInvoiceConfirmPayment(request: NextRequest, invoiceId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(invoiceId).success) {
        return badRequest('Invalid invoiceId format.');
    }

    try {
        const data = ConfirmInvoicePaymentSchema.parse(await request.json());
        const { sealInvoice } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealInvoice.confirmInvoicePayment.populateTransaction(
                invoiceId,
                BigInt(data.plaintext),
                data.signature,
            );
            return NextResponse.json({
                status: 'success',
                data: { invoiceId, tx: await buildTxRequest(tx.to as string, tx.data as string) },
            });
        }

        return NextResponse.json({ status: 'success', data: { invoiceId, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleInvoiceCancel(request: NextRequest, invoiceId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(invoiceId).success) {
        return badRequest('Invalid invoiceId format.');
    }

    try {
        const data = CancelInvoiceSchema.parse(await request.json());
        const { sealInvoice } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealInvoice.cancelInvoice.populateTransaction(invoiceId, data.reason);
            return NextResponse.json({
                status: 'success',
                data: { invoiceId, tx: await buildTxRequest(tx.to as string, tx.data as string) },
            });
        }

        return NextResponse.json({ status: 'success', data: { invoiceId, txHash: data.txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleInvoiceWithdraw(request: NextRequest, invoiceId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(invoiceId).success) {
        return badRequest('Invalid invoiceId format.');
    }

    try {
        const payload = await request.json().catch(() => ({}));
        const txHash = typeof payload?.txHash === 'string' ? payload.txHash : undefined;
        const isNative = payload?.isNative ?? false;
        const { sealInvoice } = getFhenixClients();

        if (!txHash) {
            const tx = isNative
                ? await sealInvoice.withdrawPaymentNative.populateTransaction(invoiceId)
                : await sealInvoice.withdrawPayment.populateTransaction(invoiceId);
            return NextResponse.json({
                status: 'success',
                data: {
                    invoiceId,
                    isNative,
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        return NextResponse.json({ status: 'success', data: { invoiceId, isNative, txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleInvoiceRefund(request: NextRequest, invoiceId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(invoiceId).success) {
        return badRequest('Invalid invoiceId format.');
    }

    try {
        const payload = await request.json().catch(() => ({}));
        const txHash = typeof payload?.txHash === 'string' ? payload.txHash : undefined;
        const isNative = payload?.isNative ?? false;
        const { sealInvoice } = getFhenixClients();

        if (!txHash) {
            const tx = isNative
                ? await sealInvoice.refundInvoiceNative.populateTransaction(invoiceId)
                : await sealInvoice.refundInvoice.populateTransaction(invoiceId);
            return NextResponse.json({
                status: 'success',
                data: {
                    invoiceId,
                    isNative,
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        return NextResponse.json({ status: 'success', data: { invoiceId, isNative, txHash } });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}

export async function handleInvoiceGetReceipt(request: NextRequest, invoiceId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(invoiceId).success) {
        return badRequest('Invalid invoiceId format.');
    }

    try {
        const { sealInvoice } = getFhenixClients();
        const receipt = await sealInvoice.getReceiptForInvoice(invoiceId);
        const receiptId = String(receipt.receiptId);

        if (receiptId === '0x' + '0'.repeat(64)) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'Receipt not found' } },
                { status: 404 },
            );
        }

        return NextResponse.json({
            status: 'success',
            data: {
                receiptId,
                invoiceId: String(receipt.invoiceId),
                payer: String(receipt.payer),
                payee: String(receipt.payee),
                token: String(receipt.token),
                amount: BigInt(receipt.amount).toString(),
                timestamp: Number(receipt.timestamp),
                txHash: String(receipt.txHash),
            },
        });
    } catch (error: any) {
        return serverError(error.message || 'Failed to fetch receipt');
    }
}

export async function handleInvoiceConfirmTransfer(request: NextRequest, invoiceId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    if (!bytes32Schema.safeParse(invoiceId).success) {
        return badRequest('Invalid invoiceId format.');
    }

    try {
        const data = ConfirmTransferSchema.parse(await request.json());
        const { sealInvoice } = getFhenixClients();

        if (!data.txHash) {
            const tx = await sealInvoice.confirmTransferVerification.populateTransaction(
                data.transferId,
                data.success,
                data.signature,
            );
            return NextResponse.json({
                status: 'success',
                data: {
                    invoiceId,
                    transferId: data.transferId,
                    success: data.success,
                    tx: await buildTxRequest(tx.to as string, tx.data as string),
                },
            });
        }

        return NextResponse.json({
            status: 'success',
            data: { invoiceId, transferId: data.transferId, success: data.success, txHash: data.txHash },
        });
    } catch (error: any) {
        return badRequest(error.message || 'Invalid request payload');
    }
}
