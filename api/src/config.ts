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
  // Time zone used for timestamps in alert emails (IANA name, e.g. "America/New_York").
  alertTimezone: process.env.ALERT_TIMEZONE || "UTC",
  // Sender address for alert emails, e.g. "DevMonitor <support@veganext.com>" (falls back to SMTP_FROM).
  mailFrom: process.env.MAIL_FROM || process.env.SMTP_FROM || "DevMonitor <alerts@veganext.com>",
  // Microsoft 365 via Microsoft Graph (preferred for Exchange Online; SMTP basic auth is retired).
  graph: {
    tenantId: process.env.GRAPH_TENANT_ID || "",
    clientId: process.env.GRAPH_CLIENT_ID || "",
    clientSecret: process.env.GRAPH_CLIENT_SECRET || "",
    // Override only for national clouds (e.g. https://login.microsoftonline.us / https://graph.microsoft.us).
    authorityHost: process.env.GRAPH_AUTHORITY_HOST || "https://login.microsoftonline.com",
    apiHost: process.env.GRAPH_API_HOST || "https://graph.microsoft.com",
  },
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "DevMonitor <alerts@veganext.com>",
    // Extra recipients on top of the ones managed in the UI (comma/semicolon separated).
    to: process.env.ALERT_TO_EMAIL || "",
  },
};
