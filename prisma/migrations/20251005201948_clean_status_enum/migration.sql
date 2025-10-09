-- AlterTable
ALTER TABLE "public"."Batch" ADD COLUMN     "status" "public"."Status" NOT NULL DEFAULT 'WAITING_BATCH';
