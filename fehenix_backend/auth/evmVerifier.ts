import { verifyMessage, getAddress } from 'ethers';

/**
 * Verify an EVM wallet signature (personal_sign / eth_sign).
 * Returns true if the recovered signer matches walletAddress.
 */
export async function verifyEvmWalletSignature(
    walletAddress: string,
    message: string,
    signature: string,
): Promise<boolean> {
    try {
        const recovered = verifyMessage(message, signature);
        return getAddress(recovered) === getAddress(walletAddress);
    } catch {
        return false;
    }
}
