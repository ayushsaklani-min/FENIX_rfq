# Fhenix Backend API Documentation

This document describes the complete API surface for the Fhenix/EVM backend that drives the SEAL contract suite.

## Base URL
All endpoints are prefixed with `/api/fhenix/`

## Authentication
All endpoints require JWT authentication via `Authorization: Bearer <token>` header.
Supported roles: `BUYER`, `VENDOR`, `AUDITOR`, `NEW_USER`

## Response Format
All responses follow this structure:
```json
{
  "status": "success" | "error",
  "data": { ... } | null,
  "error": { "code": "...", "message": "..." } | null
}
```

## Transaction Flow
Most write operations return an unsigned transaction object:
```json
{
  "tx": {
    "to": "0x...",
    "data": "0x...",
    "value": "0",
    "chainId": 11155111
  }
}
```
The client should sign and broadcast this transaction using their wallet.

---

# Frontend Integration Guide

## Required Dependencies

```bash
npm install @cofhe/sdk ethers@^6 viem wagmi
```

## CoFHE Client Setup

```typescript
// lib/cofhe.ts
import { createCofheConfig, createCofheClient } from '@cofhe/sdk/web';
import { Encryptable, FheTypes } from '@cofhe/sdk';
import { chains } from '@cofhe/sdk/chains';

const config = createCofheConfig({
  supportedChains: [chains.sepolia],
});

export const cofheClient = createCofheClient(config);
export { Encryptable, FheTypes };
```

## Connecting to CoFHE

```typescript
import { cofheClient } from './lib/cofhe';
import { usePublicClient, useWalletClient } from 'wagmi';

// In your React component
const publicClient = usePublicClient();
const { data: walletClient } = useWalletClient();

// Connect once when wallet connects
await cofheClient.connect(publicClient, walletClient);

// Create permit for decryption (one-time per account)
await cofheClient.permits.getOrCreateSelfPermit();
```

## Encrypting Bid Amounts

The `encryptedBid` field in bid submissions uses the CoFHE SDK's `EncryptedItemInput` type:

```typescript
import { Encryptable } from '@cofhe/sdk';
import { cofheClient } from './lib/cofhe';

async function encryptBidAmount(bidAmount: bigint): Promise<{
  ctHash: string;
  securityZone: number;
  utype: number;
  signature: string;
}> {
  const [encrypted] = await cofheClient
    .encryptInputs([Encryptable.uint64(bidAmount)])
    .execute();

  return {
    ctHash: encrypted.ctHash.toString(),  // Convert bigint to decimal string
    securityZone: encrypted.securityZone,
    utype: encrypted.utype,
    signature: encrypted.signature,
  };
}
```

## Complete Bid Submission Example

```typescript
import { encryptBidAmount } from './lib/encryption';

async function submitBid(rfqId: string, bidAmount: bigint, stake: bigint) {
  // 1. Encrypt the bid amount using CoFHE SDK
  const encryptedBid = await encryptBidAmount(bidAmount);

  // 2. Call backend API to get unsigned transaction
  const response = await fetch(`/api/fhenix/rfq/${rfqId}/bids`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      stake: stake.toString(),
      encryptedBid,
    }),
  });

  const { data } = await response.json();
  
  // 3. Sign and send the transaction using wallet
  const txHash = await walletClient.sendTransaction({
    to: data.tx.to,
    data: data.tx.data,
    value: BigInt(data.tx.value),
    chainId: data.tx.chainId,
  });

  return { bidId: data.bidId, txHash };
}
```

## Decrypting for Winner Selection

When selecting a winner, you need to decrypt the encrypted bid value:

```typescript
import { FheTypes } from '@cofhe/sdk';
import { cofheClient } from './lib/cofhe';

async function decryptAndSelectWinner(rfqId: string, winnerBidId: string, ctHash: bigint) {
  // 1. Decrypt the bid value using CoFHE SDK (for on-chain verification)
  const decryptResult = await cofheClient
    .decryptForTx(ctHash, FheTypes.Uint64)
    .execute();

  // 2. Call backend API with decrypted proof
  const response = await fetch(`/api/fhenix/rfq/${rfqId}/select-winner`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      bidId: winnerBidId,
      plaintext: decryptResult.decryptedValue.toString(),
      signature: decryptResult.signature,
    }),
  });

  const { data } = await response.json();
  
  // 3. Sign and send transaction
  const txHash = await walletClient.sendTransaction({
    to: data.tx.to,
    data: data.tx.data,
    value: BigInt(data.tx.value),
  });

  return txHash;
}
```

## Reading Encrypted Values for UI Display

```typescript
import { FheTypes } from '@cofhe/sdk';
import { cofheClient } from './lib/cofhe';

async function viewMyBidAmount(ctHash: bigint): Promise<bigint> {
  // Ensure permit exists
  await cofheClient.permits.getOrCreateSelfPermit();

  // Decrypt for local viewing (not on-chain)
  const plaintext = await cofheClient
    .decryptForView(ctHash, FheTypes.Uint64)
    .execute();

  return plaintext; // bigint
}
```

---

## TypeScript Types

```typescript
// EncryptedItemInput - from @cofhe/sdk
// This is what the frontend sends to the backend
interface EncryptedBidInput {
  ctHash: string;        // bigint as decimal string (e.g., "12345...")
  securityZone: number;  // typically 0
  utype: number;         // 4 = uint64 (FheTypes.Uint64)
  signature: string;     // hex string "0x..."
}

// Transaction response from backend
interface TransactionPayload {
  to: string;            // contract address
  data: string;          // encoded call data
  value: string;         // wei as string
  chainId: number;       // 11155111 for Ethereum Sepolia
}

// Standard API response
interface ApiResponse<T> {
  status: 'success' | 'error';
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// RFQ response type
interface RfqData {
  id: string;
  creator: string;
  biddingDeadline: number;
  revealDeadline: number;
  minBid: string;
  minBidCount: string;
  flatStake: string;
  metadataHash: string;
  tokenType: number;
  mode: number;
  statusCode: number;
  status: string;
  bidCount: string;
  winnerAddress: string;
  winnerAccepted: boolean;
  paid: boolean;
  escrow: {
    originalAmount: string;
    currentAmount: string;
    totalReleased: string;
  };
}
```

---

---

## RFQ Endpoints

### POST `/api/fhenix/rfq/create`
Create a new RFQ.

**Request Body:**
```json
{
  "salt": "0x...",           // bytes32 - random salt
  "biddingDeadline": 12345,  // block number
  "revealDeadline": 12400,   // block number
  "minBid": "1000",          // uint64 as string
  "minBidCount": "2",        // uint64 as string
  "metadataHash": "0x...",   // bytes32
  "tokenType": 0,            // 0=Token1, 1=Token2
  "mode": 0                  // 0=Standard, 1=Vickrey, 2=Dutch
}
```

### GET `/api/fhenix/rfq/[id]`
Get RFQ details by ID.

### POST `/api/fhenix/rfq/[id]/bids`
Submit an encrypted bid.

**Request Body:**
```json
{
  "bidId": "0x...",          // optional, auto-generated if not provided
  "stake": "10000",          // uint64 as string
  "encryptedBid": {
    "ctHash": "123...",      // uint256 as decimal string
    "securityZone": 0,       // uint8
    "utype": 4,              // uint8 (4 = euint64)
    "signature": "0x..."     // FHE signature bytes
  }
}
```

### POST `/api/fhenix/rfq/[id]/close`
Close bidding phase.

### POST `/api/fhenix/rfq/[id]/select-winner`
Select winning bid.

**Request Body:**
```json
{
  "bidId": "0x...",          // bytes32
  "plaintext": "5000",       // uint64 as string (decrypted bid)
  "signature": "0x..."       // threshold signature
}
```

### POST `/api/fhenix/rfq/[id]/winner-respond`
Winner accepts or rejects.

**Request Body:**
```json
{
  "accept": true
}
```

### POST `/api/fhenix/rfq/[id]/fund-escrow`
Fund the escrow.

**Request Body:**
```json
{
  "tokenType": 0,            // 0=Token1, 1=Token2
  "amount": "1000000"        // required for all types
}
```

### POST `/api/fhenix/rfq/[id]/release`
Release partial payment.

**Request Body:**
```json
{
  "percentage": 50           // 1-100
}
```

### POST `/api/fhenix/rfq/[id]/import-auction`
Import auction result from Vickrey/Dutch contract.

**Request Body:**
```json
{
  "auctionId": "0x...",      // bytes32
  "auctionType": 1,          // 1=Vickrey, 2=Dutch
  "auctionContract": "0x..." // optional, uses env default
}
```

---

## Vickrey Auction Endpoints

### POST `/api/fhenix/auction/vickrey/create`
Create a new Vickrey auction.

**Request Body:**
```json
{
  "salt": "0x...",           // bytes32
  "rfqId": "0x...",          // optional, links to RFQ
  "biddingDeadline": 12345,  // block number
  "revealDeadline": 12400,   // block number
  "flatStake": "10000",      // uint64 as string
  "minBidCount": "2"         // uint64 as string
}
```

### GET `/api/fhenix/auction/vickrey/[id]`
Get auction details.

### POST `/api/fhenix/auction/vickrey/[id]/bids`
Submit encrypted bid (commit phase).

**Request Body:**
```json
{
  "bidId": "0x...",          // optional
  "encryptedBid": {
    "ctHash": "123...",
    "securityZone": 0,
    "utype": 4,
    "signature": "0x..."
  }
}
```

### GET `/api/fhenix/auction/vickrey/[id]/bids/[bidId]`
Get bid details.

### POST `/api/fhenix/auction/vickrey/[id]/close`
Close bidding phase (move to reveal).

### POST `/api/fhenix/auction/vickrey/[id]/reveal`
Reveal a bid.

**Request Body:**
```json
{
  "bidId": "0x...",
  "plaintext": "5000",
  "signature": "0x..."
}
```

### POST `/api/fhenix/auction/vickrey/[id]/finalize`
Finalize auction and declare winner.

**Request Body:**
```json
{
  "lowestBidPlaintext": "5000",
  "lowestBidSignature": "0x...",
  "secondBidPlaintext": "6000",
  "secondBidSignature": "0x...",
  "winnerPlaintext": "0x...",
  "winnerSignature": "0x..."
}
```

### POST `/api/fhenix/auction/vickrey/[id]/cancel`
Cancel the auction (creator only).

### POST `/api/fhenix/auction/vickrey/[id]/claim-stake`
Claim stake refund.

**Request Body:**
```json
{
  "bidId": "0x..."
}
```

### GET `/api/fhenix/auction/vickrey/[id]/result`
Get auction result (winner, final price).

---

## Dutch Auction Endpoints

### POST `/api/fhenix/auction/dutch/create`
Create a new Dutch auction.

**Request Body:**
```json
{
  "salt": "0x...",           // bytes32
  "rfqId": "0x...",          // optional
  "startPrice": "100000",    // uint64 as string
  "reservePrice": "10000",   // uint64 as string
  "priceDecrement": "100",   // uint64 as string (per block)
  "startBlock": 12345,
  "endBlock": 12500
}
```

### GET `/api/fhenix/auction/dutch/[id]`
Get auction details (includes current price).

### GET `/api/fhenix/auction/dutch/[id]/price`
Get current price and block.

### POST `/api/fhenix/auction/dutch/[id]/commit`
Commit to accept current price.

**Request Body:**
```json
{
  "acceptanceId": "0x..."    // optional
}
```

### POST `/api/fhenix/auction/dutch/[id]/confirm`
Confirm acceptance within window.

**Request Body:**
```json
{
  "acceptanceId": "0x..."
}
```

### POST `/api/fhenix/auction/dutch/[id]/accept-price`
Direct price acceptance (skip commit-confirm).

### POST `/api/fhenix/auction/dutch/[id]/reset`
Reset expired commitment.

**Request Body:**
```json
{
  "acceptanceId": "0x..."
}
```

### POST `/api/fhenix/auction/dutch/[id]/cancel`
Cancel the auction (creator only).

### POST `/api/fhenix/auction/dutch/[id]/claim-stake`
Claim stake refund.

**Request Body:**
```json
{
  "acceptanceId": "0x..."
}
```

### GET `/api/fhenix/auction/dutch/[id]/acceptances/[acceptanceId]`
Get acceptance details.

### GET `/api/fhenix/auction/dutch/[id]/result`
Get auction result.

---

## Invoice Endpoints

### POST `/api/fhenix/invoice/create`
Create a new invoice.

**Request Body:**
```json
{
  "salt": "0x...",
  "payee": "0x...",
  "token": "0x...",          // optional, 0x0 for native
  "amount": "1000000",
  "rfqId": "0x...",          // optional
  "orderId": "0x...",        // optional
  "description": "Payment for services"
}
```

### GET `/api/fhenix/invoice/[id]`
Get invoice details.

### POST `/api/fhenix/invoice/[id]/pay`
Pay an invoice.

**Request Body:**
```json
{
  "isNative": true           // optional, auto-detected from token
}
```

### POST `/api/fhenix/invoice/[id]/cancel`
Cancel an invoice.

**Request Body:**
```json
{
  "reason": "Order cancelled"
}
```

### POST `/api/fhenix/invoice/[id]/withdraw`
Withdraw payment (payee).

**Request Body:**
```json
{
  "isNative": true
}
```

### POST `/api/fhenix/invoice/[id]/refund`
Refund payment (payee to payer).

**Request Body:**
```json
{
  "isNative": true
}
```

### GET `/api/fhenix/invoice/[id]/receipt`
Get payment receipt for invoice.

---

## Environment Variables

Required for Fhenix backend:
```env
FHENIX_BACKEND_ENABLED=true
FHENIX_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
FHENIX_CHAIN_ID=11155111
FHENIX_PRIVATE_KEY=0x...
FHENIX_SEAL_RFQ_ADDRESS=0x...
FHENIX_SEAL_VICKREY_ADDRESS=0x...
FHENIX_SEAL_DUTCH_ADDRESS=0x...
FHENIX_SEAL_INVOICE_ADDRESS=0x...
```

---

## Status Codes

### RFQ Status
| Code | Label |
|------|-------|
| 0 | NONE |
| 1 | BIDDING |
| 2 | REVEAL |
| 3 | WINNER_SELECTED |
| 4 | ESCROW_FUNDED |
| 5 | COMPLETED |
| 6 | CANCELLED |
| 7 | REJECTED |

### Vickrey Auction Status
| Code | Label |
|------|-------|
| 0 | NONE |
| 1 | OPEN |
| 2 | REVEAL |
| 3 | FINALIZED |
| 4 | CANCELLED |

### Dutch Auction Status
| Code | Label |
|------|-------|
| 0 | NONE |
| 1 | ACTIVE |
| 2 | COMMITTED |
| 3 | CONFIRMED |
| 4 | EXPIRED |
| 5 | CANCELLED |

### Invoice Status
| Code | Label |
|------|-------|
| 0 | NONE |
| 1 | PENDING |
| 2 | PAID |
| 3 | COMPLETED |
| 4 | CANCELLED |
| 5 | REFUNDED |
