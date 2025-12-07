/*
  Warnings:

  - You are about to drop the column `quantity` on the `MainStock` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."MainStock" DROP COLUMN "quantity",
ADD COLUMN     "totalQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "public"."StockVariant" ADD COLUMN     "variantTitle" TEXT;

-- CreateTable
CREATE TABLE "public"."ProductStockQuantity" (
    "id" TEXT NOT NULL,
    "mainStockId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductStockQuantity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductStockQuantity_mainStockId_productVariantId_key" ON "public"."ProductStockQuantity"("mainStockId", "productVariantId");

-- CreateIndex
CREATE INDEX "StockVariant_variantTitle_idx" ON "public"."StockVariant"("variantTitle");

-- AddForeignKey
ALTER TABLE "public"."ProductStockQuantity" ADD CONSTRAINT "ProductStockQuantity_mainStockId_fkey" FOREIGN KEY ("mainStockId") REFERENCES "public"."MainStock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductStockQuantity" ADD CONSTRAINT "ProductStockQuantity_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "public"."ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
