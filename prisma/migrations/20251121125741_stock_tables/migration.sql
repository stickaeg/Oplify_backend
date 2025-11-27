-- CreateEnum
CREATE TYPE "public"."ReservationStatus" AS ENUM ('RESERVED', 'FULFILLED', 'RELEASED');

-- CreateEnum
CREATE TYPE "public"."MovementType" AS ENUM ('PURCHASE', 'SALE', 'ADJUSTMENT', 'DAMAGE', 'RETURN');

-- AlterTable
ALTER TABLE "public"."Batch" ADD COLUMN     "handlesStock" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."ProductTypeRule" ADD COLUMN     "requiresStock" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."StockItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockVariant" (
    "id" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "size" TEXT,
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "minStockLevel" INTEGER NOT NULL DEFAULT 5,
    "maxStockLevel" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductStockMapping" (
    "id" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "stockVariantId" TEXT NOT NULL,
    "quantityRequired" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductStockMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockReservation" (
    "id" TEXT NOT NULL,
    "stockVariantId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "public"."ReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "expiresAt" TIMESTAMP(3),
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockMovement" (
    "id" TEXT NOT NULL,
    "stockVariantId" TEXT NOT NULL,
    "type" "public"."MovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "previousStock" INTEGER NOT NULL,
    "newStock" INTEGER NOT NULL,
    "orderItemId" TEXT,
    "batchId" TEXT,
    "userId" INTEGER,
    "reason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_sku_key" ON "public"."StockItem"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "StockVariant_sku_key" ON "public"."StockVariant"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductStockMapping_productVariantId_stockVariantId_key" ON "public"."ProductStockMapping"("productVariantId", "stockVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "StockReservation_orderItemId_key" ON "public"."StockReservation"("orderItemId");

-- CreateIndex
CREATE INDEX "StockReservation_stockVariantId_status_idx" ON "public"."StockReservation"("stockVariantId", "status");

-- CreateIndex
CREATE INDEX "StockMovement_stockVariantId_createdAt_idx" ON "public"."StockMovement"("stockVariantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_type_idx" ON "public"."StockMovement"("type");

-- AddForeignKey
ALTER TABLE "public"."StockVariant" ADD CONSTRAINT "StockVariant_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "public"."StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductStockMapping" ADD CONSTRAINT "ProductStockMapping_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "public"."ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductStockMapping" ADD CONSTRAINT "ProductStockMapping_stockVariantId_fkey" FOREIGN KEY ("stockVariantId") REFERENCES "public"."StockVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockReservation" ADD CONSTRAINT "StockReservation_stockVariantId_fkey" FOREIGN KEY ("stockVariantId") REFERENCES "public"."StockVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockReservation" ADD CONSTRAINT "StockReservation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "public"."OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockMovement" ADD CONSTRAINT "StockMovement_stockVariantId_fkey" FOREIGN KEY ("stockVariantId") REFERENCES "public"."StockVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
