/*
  Warnings:

  - A unique constraint covering the columns `[orderId,productId,variantId]` on the table `OrderItem` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."OrderItem_orderId_productId_key";

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_productId_variantId_key" ON "public"."OrderItem"("orderId", "productId", "variantId");
