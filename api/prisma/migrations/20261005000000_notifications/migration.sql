-- CreateTable
CREATE TABLE "NotificationRecipient" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "incidentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRecipient_email_key" ON "NotificationRecipient"("email");

-- CreateIndex
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");

-- Seed: Veganext admin recipients
INSERT INTO "NotificationRecipient" ("id", "email") VALUES
    ('seed_admin_arahali',   'arahali@veganext.com'),
    ('seed_admin_sross',     'sross@veganext.com'),
    ('seed_admin_ebonilla',  'ebonilla@veganext.com'),
    ('seed_admin_pervez',    'pervez@veganext.com'),
    ('seed_admin_ckhiari',   'ckhiari@veganext.com'),
    ('seed_admin_shajiyani', 'shajiyani@veganext.com')
ON CONFLICT ("email") DO NOTHING;
