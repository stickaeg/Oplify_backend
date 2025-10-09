-- AlterTable
ALTER TABLE "public"."BatchItem" ADD COLUMN     "status" "public"."Status" NOT NULL DEFAULT 'WAITING_BATCH';
