-- AlterTable
ALTER TABLE "User" ADD COLUMN     "blockedBy" TEXT,
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;
