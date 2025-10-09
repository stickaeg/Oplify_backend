/*
  Warnings:

  - A unique constraint covering the columns `[qrCodeToken]` on the table `Batch` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[qrCodeToken]` on the table `BatchItem` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."Batch" ADD COLUMN     "qrCodeToken" TEXT,
ADD COLUMN     "qrCodeUrl" TEXT;

-- AlterTable
ALTER TABLE "public"."BatchItem" ADD COLUMN     "qrCodeToken" TEXT,
ADD COLUMN     "qrCodeUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Batch_qrCodeToken_key" ON "public"."Batch"("qrCodeToken");

-- CreateIndex
CREATE UNIQUE INDEX "BatchItem_qrCodeToken_key" ON "public"."BatchItem"("qrCodeToken");
