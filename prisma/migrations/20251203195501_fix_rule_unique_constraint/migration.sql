/*
  Warnings:

  - A unique constraint covering the columns `[name,variantTitle,storeId]` on the table `ProductTypeRule` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."ProductTypeRule_name_storeId_key";

-- CreateIndex
CREATE UNIQUE INDEX "ProductTypeRule_name_variantTitle_storeId_key" ON "public"."ProductTypeRule"("name", "variantTitle", "storeId");
