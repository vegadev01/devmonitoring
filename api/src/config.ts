import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 4000),
  adminUser: process.env.ADMIN_USER || "admin",
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || "",
  sessionSecret: process.env.SESSION_SECRET || "change-me-too",
  checkIntervalMs: Number(process.env.CHECK_INTERVAL_MS || 120_000),
  serverOfflineAfterMs: Number(process.env.SERVER_OFFLINE_AFTER_MS || 300_000),
  retentionDays: Number(process.env.RETENTION_DAYS || 30),
  publicWebUrl: process.env.PUBLIC_WEB_URL || "http://localhost:3000",
  publicApiUrl: process.env.PUBLIC_API_URL || "http://localhost:4000",
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "DevMonitor <alerts@veganext.com>",
    to: process.env.ALERT_TO_EMAIL || "",
  },
};
