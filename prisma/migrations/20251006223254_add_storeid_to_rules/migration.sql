/*
  Warnings:

  - Added the required column `storeId` to the `ProductTypeRule` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."ProductTypeRule" DROP CONSTRAINT "ProductTypeRule_name_fkey";

-- AlterTable
ALTER TABLE "public"."ProductTypeRule" ADD COLUMN     "storeId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "public"."ProductTypeRule" ADD CONSTRAINT "ProductTypeRule_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
