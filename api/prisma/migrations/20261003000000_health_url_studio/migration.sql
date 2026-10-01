-- AlterTable
ALTER TABLE "App" ADD COLUMN "healthUrl" TEXT;

-- CreateTable
CREATE TABLE "SavedRequest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "collection" TEXT NOT NULL DEFAULT 'General',
    "method" TEXT NOT NULL DEFAULT 'GET',
    "url" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '[]',
    "headers" JSONB NOT NULL DEFAULT '[]',
    "bodyType" TEXT NOT NULL DEFAULT 'none',
    "body" TEXT,
    "auth" JSONB NOT NULL DEFAULT '{}',
    "insecureTls" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedRequest_collection_idx" ON "SavedRequest"("collection");
