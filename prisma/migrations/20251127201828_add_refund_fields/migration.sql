-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "shopifyCurrency" TEXT,
ADD COLUMN     "shopifyLocationId" TEXT,
ADD COLUMN     "shopifyTransactions" JSONB;

-- AlterTable
ALTER TABLE "public"."OrderItem" ADD COLUMN     "shopifyLineItemId" TEXT;

-- AlterTable
ALTER TABLE "public"."Store" ADD COLUMN     "shopifyLocationId" TEXT;
