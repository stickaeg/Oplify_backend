/*
  Warnings:

  - You are about to drop the column `mainStockId` on the `ProductTypeRule` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."ProductTypeRule" DROP CONSTRAINT "ProductTypeRule_mainStockId_fkey";

-- AlterTable
ALTER TABLE "public"."ProductTypeRule" DROP COLUMN "mainStockId";

-- CreateTable
CREATE TABLE "public"."_MainStockRules" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_MainStockRules_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_MainStockRules_B_index" ON "public"."_MainStockRules"("B");

-- AddForeignKey
ALTER TABLE "public"."_MainStockRules" ADD CONSTRAINT "_MainStockRules_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."MainStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_MainStockRules" ADD CONSTRAINT "_MainStockRules_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."ProductTypeRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
