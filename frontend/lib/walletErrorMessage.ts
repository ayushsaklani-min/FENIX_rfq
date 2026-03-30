'use client';

type NormalizeWalletErrorOptions = {
    programId?: string;
    context?: 'authorization' | 'execution';
};

export function normalizeWalletErrorMessage(rawMessage: string, options: NormalizeWalletErrorOptions = {}) {
    const message = rawMessage || '';
    const lower = message.toLowerCase();
    const programId = options.programId || 'the deployed Sepolia contract';
    const isParserFailure =
        lower.includes('failed to parse string') ||
        lower.includes('remaining invalid string');
    const isSealRfqStablecoinParserFailure =
        lower.includes('merkleproof; 2u32') ||
        lower.includes('pay_invoice_usdcx') ||
        lower.includes('pay_invoice_usad') ||
        lower.includes('stablecoin/merkleproof');

    if (lower.includes('0x43d58190') || lower.includes('staketoosmall')) {
        return 'Minimum bid is too small. The RFQ contract requires a non-zero 10% flat stake, so use at least 10 raw units. With eSEAL 4 decimals, 1.0000 eSEAL is 10000.';
    }

    if (
        isParserFailure &&
        (
            options.programId?.startsWith('sealrfq_') ||
            isSealRfqStablecoinParserFailure
        )
    ) {
        return options.context === 'authorization'
            ? `Your wallet could not authorize ${programId}. This is a client compatibility problem, not an RFQ form error. Refresh the CoFHE client state and try again.`
            : `Your wallet could not parse ${programId}. This is a client compatibility problem, not an RFQ form error. Refresh the CoFHE client state and try again.`;
    }

    return message;
}
