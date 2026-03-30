-- AlterTable
ALTER TABLE "RFQ" ADD COLUMN "description" TEXT;
ALTER TABLE "RFQ" ADD COLUMN "itemName" TEXT;
ALTER TABLE "RFQ" ADD COLUMN "metadataHash" TEXT;
ALTER TABLE "RFQ" ADD COLUMN "quantity" TEXT;
ALTER TABLE "RFQ" ADD COLUMN "unit" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Bid_rfqId_vendor_key" ON "Bid"("rfqId", "vendor");
