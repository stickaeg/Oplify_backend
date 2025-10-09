/*
  Warnings:

  - You are about to drop the column `storeId` on the `Store` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `Store` will be added. If there are existing duplicate values, this will fail.
  - Made the column `name` on table `Store` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "public"."Store_storeId_key";

-- AlterTable
ALTER TABLE "public"."Product" ADD COLUMN     "imgUrl" TEXT;

-- AlterTable
ALTER TABLE "public"."Store" DROP COLUMN "storeId",
ALTER COLUMN "name" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Store_name_key" ON "public"."Store"("name");
