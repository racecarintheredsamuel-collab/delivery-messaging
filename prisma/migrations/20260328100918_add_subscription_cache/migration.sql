-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "subscriptionActive" BOOLEAN,
ADD COLUMN     "subscriptionCheckedAt" TIMESTAMP(3);
