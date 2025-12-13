-- CreateTable
CREATE TABLE "public"."ReturnedItem" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnedItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReturnedItem_storeId_idx" ON "public"."ReturnedItem"("storeId");

-- CreateIndex
CREATE INDEX "ReturnedItem_orderItemId_idx" ON "public"."ReturnedItem"("orderItemId");

-- CreateIndex
CREATE INDEX "ReturnedItem_productId_idx" ON "public"."ReturnedItem"("productId");

-- CreateIndex
CREATE INDEX "ReturnedItem_variantId_idx" ON "public"."ReturnedItem"("variantId");

-- AddForeignKey
ALTER TABLE "public"."ReturnedItem" ADD CONSTRAINT "ReturnedItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReturnedItem" ADD CONSTRAINT "ReturnedItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "public"."OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReturnedItem" ADD CONSTRAINT "ReturnedItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReturnedItem" ADD CONSTRAINT "ReturnedItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReturnedItem" ADD CONSTRAINT "ReturnedItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "public"."ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
