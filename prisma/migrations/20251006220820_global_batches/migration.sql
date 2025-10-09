-- DropForeignKey
ALTER TABLE "public"."Batch" DROP CONSTRAINT "Batch_ruleId_fkey";

-- CreateTable
CREATE TABLE "public"."_BatchRules" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BatchRules_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_BatchRules_B_index" ON "public"."_BatchRules"("B");

-- AddForeignKey
ALTER TABLE "public"."ProductTypeRule" ADD CONSTRAINT "ProductTypeRule_name_fkey" FOREIGN KEY ("name") REFERENCES "public"."Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_BatchRules" ADD CONSTRAINT "_BatchRules_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_BatchRules" ADD CONSTRAINT "_BatchRules_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."ProductTypeRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
