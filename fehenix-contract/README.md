# Fhenix SEALrfq - Private Procurement Platform

Privacy-preserving procurement and auction platform for Fhenix blockchain using Fully Homomorphic Encryption (FHE).

## Overview

This project implements the SEALrfq protocol on Fhenix, leveraging FHE for encrypted bid privacy.

## Contracts

1. **SealRFQ.sol** - Core RFQ protocol with encrypted bidding
2. **SealVickrey.sol** - Vickrey (second-price sealed-bid) auction  
3. **SealDutch.sol** - Dutch (descending price) auction
4. **SealInvoice.sol** - Invoice settlement router

## Key Features

| Feature | Implementation |
|---------|----------------|
| Privacy | Fully Homomorphic Encryption |
| Language | Solidity |
| Token Model | FHERC20 confidential tokens |
| Bid Privacy | FHE encrypted bids |
| Comparison | On-chain FHE operations |

## Installation

```bash
npm install
npx hardhat compile
```

## Testing

```bash
npx hardhat test
```

## Deployment

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

Set `STAKE_TOKEN_ADDRESS` or `TOKEN1_ADDRESS` before deployment so `SealVickrey` and `SealDutch` can escrow FHERC20 stakes.

Current CoFHE-supported public testnets are Ethereum Sepolia, Arbitrum Sepolia, and Base Sepolia. This repo is configured for Sepolia by default and can opt into the other two networks via env RPC settings.

## Architecture

### FHE-Based Privacy

This implementation uses FHE to:
- Keep bid amounts encrypted on-chain (`euint64`)
- Perform encrypted comparisons (`FHE.lt`, `FHE.gt`)
- Update encrypted state without revealing values
- Decrypt only when auction/RFQ concludes using the 3-step flow:
  `FHE.allowPublic(ct)` on-chain, `decryptForTx(ct)` off-chain, then
  `publishDecryptResult()` or `verifyDecryptResult()` on-chain

### Token Support

- All stake, escrow, invoice, and payout flows use FHERC20
- Contracts rely on the FHERC20 operator model plus `confidentialTransferFromAndCall`
- Operator approvals should be short lived because operators have full balance access until expiry.
  Use `setOperator(address(contract), uint48(block.timestamp + 10 minutes))` immediately before
  `payInvoice`, `directPayment`, `commitBid`, `acceptPrice`, `submitBid`, or `fundEscrowToken`
- Exact-value flows are validated through receiver callbacks instead of `msg.value`
- Cross-contract encrypted arguments now use `FHE.allowTransient(...)` before FHERC20 calls,
  and transfer receiver hooks grant transient access on their returned `ebool`

## License

MIT
