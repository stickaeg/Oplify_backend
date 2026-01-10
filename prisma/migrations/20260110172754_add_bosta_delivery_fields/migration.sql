-- CreateEnum
CREATE TYPE "public"."DeliveryStatus" AS ENUM ('DELIVERY_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURNED', 'EXCEPTION', 'CANCELLED');

-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "bostaDeliveryId" TEXT,
ADD COLUMN     "bostaExceptionCode" INTEGER,
ADD COLUMN     "bostaExceptionReason" TEXT,
ADD COLUMN     "bostaState" INTEGER,
ADD COLUMN     "bostaTrackingNumber" TEXT,
ADD COLUMN     "deliveryStatus" "public"."DeliveryStatus",
ADD COLUMN     "deliveryStatusUpdatedAt" TIMESTAMP(3);
