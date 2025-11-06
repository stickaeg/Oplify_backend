/*
  Warnings:

  - A unique constraint covering the columns `[name,storeId]` on the table `ProductTypeRule` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "ProductTypeRule_name_storeId_key" ON "public"."ProductTypeRule"("name", "storeId");
