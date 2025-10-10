/*
  Warnings:

  - You are about to drop the column `qrCodeToken` on the `BatchItem` table. All the data in the column will be lost.
  - You are about to drop the column `qrCodeUrl` on the `BatchItem` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."BatchItem_qrCodeToken_key";

-- AlterTable
ALTER TABLE "public"."BatchItem" DROP COLUMN "qrCodeToken",
DROP COLUMN "qrCodeUrl";

-- CreateTable
CREATE TABLE "public"."BatchItemUnit" (
    "id" TEXT NOT NULL,
    "batchItemId" TEXT NOT NULL,
    "qrCodeUrl" TEXT,
    "qrCodeToken" TEXT,
    "status" "public"."Status" NOT NULL DEFAULT 'WAITING_BATCH',

    CONSTRAINT "BatchItemUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BatchItemUnit_qrCodeToken_key" ON "public"."BatchItemUnit"("qrCodeToken");

-- AddForeignKey
ALTER TABLE "public"."BatchItemUnit" ADD CONSTRAINT "BatchItemUnit_batchItemId_fkey" FOREIGN KEY ("batchItemId") REFERENCES "public"."BatchItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
