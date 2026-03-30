-- CreateTable
CREATE TABLE "IndexerCheckpoint" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "blockHeight" INTEGER NOT NULL,
    "blockHash" TEXT NOT NULL,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isFinalized" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "AuthNonce" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nonce" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletAddress" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "refreshTokenExpiresAt" DATETIME NOT NULL,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StagingEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "txId" TEXT NOT NULL,
    "transition" TEXT NOT NULL,
    "eventIdx" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventData" TEXT NOT NULL,
    "blockHeight" INTEGER,
    "blockHash" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventVersion" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "RFQ" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "buyer" TEXT NOT NULL,
    "biddingDeadline" INTEGER NOT NULL,
    "revealDeadline" INTEGER NOT NULL,
    "minBid" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdBlock" INTEGER NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "createdTxId" TEXT NOT NULL,
    "createdEventIdx" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "commitmentHash" TEXT NOT NULL,
    "stake" BIGINT NOT NULL,
    "revealedAmount" BIGINT,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "isRevealed" BOOLEAN NOT NULL DEFAULT false,
    "isSlashed" BOOLEAN NOT NULL DEFAULT false,
    "isRefunded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdBlock" INTEGER NOT NULL,
    "revealedBlock" INTEGER,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "createdTxId" TEXT NOT NULL,
    "createdEventIdx" INTEGER NOT NULL,
    CONSTRAINT "Bid_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Escrow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "totalAmount" BIGINT NOT NULL,
    "releasedAmount" BIGINT NOT NULL DEFAULT 0,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "fundedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fundedBlock" INTEGER NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "fundedTxId" TEXT NOT NULL,
    "fundedEventIdx" INTEGER NOT NULL,
    CONSTRAINT "Escrow_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "isFinal" BOOLEAN NOT NULL,
    "releasedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedBlock" INTEGER NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "releasedTxId" TEXT NOT NULL,
    "releasedEventIdx" INTEGER NOT NULL,
    CONSTRAINT "Payment_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RFQEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    "rfqId" TEXT,
    "eventData" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "transition" TEXT NOT NULL,
    "eventIdx" INTEGER NOT NULL,
    "blockHeight" INTEGER NOT NULL,
    "blockHash" TEXT NOT NULL,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "RFQEvent_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "idempotencyKey" TEXT NOT NULL,
    "canonicalTxKey" TEXT NOT NULL,
    "txHash" TEXT,
    "transition" TEXT NOT NULL,
    "programId" TEXT NOT NULL DEFAULT 'sepolia-sealrfq',
    "status" TEXT NOT NULL,
    "statusHistory" TEXT NOT NULL DEFAULT '[]',
    "preparedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    "confirmedAt" DATETIME,
    "rejectedAt" DATETIME,
    "expiredAt" DATETIME,
    "blockHeight" INTEGER,
    "blockHash" TEXT,
    "error" TEXT,
    "errorCode" INTEGER,
    "errorClass" TEXT,
    "rawResponse" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "lastRetryAt" DATETIME,
    "expiresAt" DATETIME,
    "lastReconciledAt" DATETIME,
    "reconcileAttempts" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "ReorgEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fromBlock" INTEGER NOT NULL,
    "toBlock" INTEGER NOT NULL,
    "fromHash" TEXT NOT NULL,
    "toHash" TEXT NOT NULL,
    "eventsRolledBack" INTEGER NOT NULL,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recoveredAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "IndexerCheckpoint_blockHeight_key" ON "IndexerCheckpoint"("blockHeight");

-- CreateIndex
CREATE UNIQUE INDEX "AuthNonce_nonce_key" ON "AuthNonce"("nonce");

-- CreateIndex
CREATE INDEX "AuthNonce_walletAddress_idx" ON "AuthNonce"("walletAddress");

-- CreateIndex
CREATE INDEX "AuthNonce_expiresAt_idx" ON "AuthNonce"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_refreshToken_key" ON "AuthSession"("refreshToken");

-- CreateIndex
CREATE INDEX "AuthSession_walletAddress_idx" ON "AuthSession"("walletAddress");

-- CreateIndex
CREATE INDEX "AuthSession_refreshToken_idx" ON "AuthSession"("refreshToken");

-- CreateIndex
CREATE INDEX "AuthSession_isRevoked_idx" ON "AuthSession"("isRevoked");

-- CreateIndex
CREATE INDEX "AuthSession_refreshTokenExpiresAt_idx" ON "AuthSession"("refreshTokenExpiresAt");

-- CreateIndex
CREATE INDEX "StagingEvent_txId_idx" ON "StagingEvent"("txId");

-- CreateIndex
CREATE INDEX "StagingEvent_eventType_idx" ON "StagingEvent"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "StagingEvent_txId_transition_eventIdx_key" ON "StagingEvent"("txId", "transition", "eventIdx");

-- CreateIndex
CREATE INDEX "RFQ_buyer_idx" ON "RFQ"("buyer");

-- CreateIndex
CREATE INDEX "RFQ_status_idx" ON "RFQ"("status");

-- CreateIndex
CREATE INDEX "RFQ_createdBlock_idx" ON "RFQ"("createdBlock");

-- CreateIndex
CREATE UNIQUE INDEX "RFQ_createdTxId_createdEventIdx_key" ON "RFQ"("createdTxId", "createdEventIdx");

-- CreateIndex
CREATE INDEX "Bid_rfqId_idx" ON "Bid"("rfqId");

-- CreateIndex
CREATE INDEX "Bid_vendor_idx" ON "Bid"("vendor");

-- CreateIndex
CREATE INDEX "Bid_isRevealed_idx" ON "Bid"("isRevealed");

-- CreateIndex
CREATE INDEX "Bid_createdBlock_idx" ON "Bid"("createdBlock");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_createdTxId_createdEventIdx_key" ON "Bid"("createdTxId", "createdEventIdx");

-- CreateIndex
CREATE UNIQUE INDEX "Escrow_rfqId_key" ON "Escrow"("rfqId");

-- CreateIndex
CREATE INDEX "Escrow_rfqId_idx" ON "Escrow"("rfqId");

-- CreateIndex
CREATE UNIQUE INDEX "Escrow_fundedTxId_fundedEventIdx_key" ON "Escrow"("fundedTxId", "fundedEventIdx");

-- CreateIndex
CREATE INDEX "Payment_rfqId_idx" ON "Payment"("rfqId");

-- CreateIndex
CREATE INDEX "Payment_recipient_idx" ON "Payment"("recipient");

-- CreateIndex
CREATE INDEX "Payment_isFinal_idx" ON "Payment"("isFinal");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_releasedTxId_releasedEventIdx_key" ON "Payment"("releasedTxId", "releasedEventIdx");

-- CreateIndex
CREATE INDEX "RFQEvent_eventType_idx" ON "RFQEvent"("eventType");

-- CreateIndex
CREATE INDEX "RFQEvent_rfqId_idx" ON "RFQEvent"("rfqId");

-- CreateIndex
CREATE INDEX "RFQEvent_blockHeight_idx" ON "RFQEvent"("blockHeight");

-- CreateIndex
CREATE INDEX "RFQEvent_txId_idx" ON "RFQEvent"("txId");

-- CreateIndex
CREATE UNIQUE INDEX "RFQEvent_txId_transition_eventIdx_key" ON "RFQEvent"("txId", "transition", "eventIdx");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_txHash_key" ON "Transaction"("txHash");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE INDEX "Transaction_canonicalTxKey_idx" ON "Transaction"("canonicalTxKey");

-- CreateIndex
CREATE INDEX "Transaction_transition_idx" ON "Transaction"("transition");

-- CreateIndex
CREATE INDEX "Transaction_submittedAt_idx" ON "Transaction"("submittedAt");

-- CreateIndex
CREATE INDEX "Transaction_expiresAt_idx" ON "Transaction"("expiresAt");

-- CreateIndex
CREATE INDEX "ReorgEvent_fromBlock_idx" ON "ReorgEvent"("fromBlock");

-- CreateIndex
CREATE INDEX "ReorgEvent_detectedAt_idx" ON "ReorgEvent"("detectedAt");

