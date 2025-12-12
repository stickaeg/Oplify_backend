/*
  Warnings:

  - You are about to drop the column `variantTitle` on the `StockVariant` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."StockVariant_variantTitle_idx";

-- AlterTable
ALTER TABLE "public"."StockVariant" DROP COLUMN "variantTitle",
ADD COLUMN     "productTypes" TEXT[],
ADD COLUMN     "storeIds" TEXT[],
ADD COLUMN     "variantTitles" TEXT[];
