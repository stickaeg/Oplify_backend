-- AlterTable
ALTER TABLE "public"."ProductTypeRule" ADD COLUMN     "mainStockId" TEXT;

-- CreateTable
CREATE TABLE "public"."MainStock" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MainStock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MainStock_name_key" ON "public"."MainStock"("name");

-- AddForeignKey
ALTER TABLE "public"."ProductTypeRule" ADD CONSTRAINT "ProductTypeRule_mainStockId_fkey" FOREIGN KEY ("mainStockId") REFERENCES "public"."MainStock"("id") ON DELETE SET NULL ON UPDATE CASCADE;
