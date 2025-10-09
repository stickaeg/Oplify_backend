/*
  Warnings:

  - The `status` column on the `Order` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `imgUrl` on the `ProductVariant` table. All the data in the column will be lost.
  - You are about to drop the column `inventoryQuantity` on the `ProductVariant` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `OrderItem` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."Status" AS ENUM ('PENDING', 'WAITING_BATCH', 'BATCHED', 'DESIGNING', 'PRINTING', 'CUTTING', 'FULFILLMENT', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "public"."Order" DROP COLUMN "status",
ADD COLUMN     "status" "public"."Status" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "public"."OrderItem" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "status" "public"."Status" NOT NULL DEFAULT 'WAITING_BATCH',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "public"."ProductVariant" DROP COLUMN "imgUrl",
DROP COLUMN "inventoryQuantity";

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "public"."Order"("status");

-- CreateIndex
CREATE INDEX "OrderItem_status_idx" ON "public"."OrderItem"("status");
