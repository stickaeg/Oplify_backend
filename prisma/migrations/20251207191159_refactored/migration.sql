/*
  Warnings:

  - You are about to drop the column `productVariantId` on the `ProductStockQuantity` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[mainStockId,sku]` on the table `ProductStockQuantity` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `sku` to the `ProductStockQuantity` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."ProductStockQuantity" DROP CONSTRAINT "ProductStockQuantity_mainStockId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ProductStockQuantity" DROP CONSTRAINT "ProductStockQuantity_productVariantId_fkey";

-- DropIndex
DROP INDEX "public"."ProductStockQuantity_mainStockId_productVariantId_key";

-- AlterTable
ALTER TABLE "public"."ProductStockQuantity" DROP COLUMN "productVariantId",
ADD COLUMN     "sku" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ProductStockQuantity_mainStockId_sku_key" ON "public"."ProductStockQuantity"("mainStockId", "sku");
