import nodemailer from "nodemailer";
import { config } from "./config";
import { prisma } from "./db";
import { GraphError, fromAddress, graphConfigured, graphSendMail, graphVerify, isValidTz, outlookTimezone } from "./graph";

// Email notifications for every issue DevMonitor detects. Each recipient gets their own message
// (one bad address can't block the others), failed sends are retried, and every outcome is logged
// in NotificationLog so delivery can be audited from the Notifications page. Timestamps are shown in
// each recipient's own time zone.

export type IssueType = "app_down" | "app_recovered" | "server_offline" | "server_recovered" | "system_error" | "test";

export type IssueEvent = {
  type: IssueType;
  service: { kind: "Application" | "Server" | "System"; name: string; environment?: string; url?: string };
  occurredAt: Date;
  error?: string | null;
  /** Extra label/value rows shown in the email. Dates are rendered in each recipient's time zone. */
  details?: [string, string | Date][];
  /** Deep link into DevMonitor. */
  link?: string;
  incidentId?: string;
};

export type DeliveryResult = { recipient: string; status: "sent" | "failed" | "skipped"; attempts: number; error?: string };

const META: Record<IssueType, { label: string; tone: "critical" | "resolved" | "info"; icon: string }> = {
  app_down: { label: "Application down", tone: "critical", icon: "🔴" },
  app_recovered: { label: "Application recovered", tone: "resolved", icon: "🟢" },
  server_offline: { label: "Server offline", tone: "critical", icon: "🔴" },
  server_recovered: { label: "Server back online", tone: "resolved", icon: "🟢" },
  system_error: { label: "Monitoring system error", tone: "critical", icon: "⚠️" },
  test: { label: "Test notification", tone: "info", icon: "✉️" },
};

const TONE = {
  critical: { color: "#d4493f", soft: "#fbe9e7", word: "Issue detected" },
  resolved: { color: "#1f9d78", soft: "#e3f5ef", word: "Resolved" },
  info: { color: "#1b6a8c", soft: "#e3f0f5", word: "Information" },
};

// Microsoft Graph wins when configured (Microsoft 365 has retired SMTP basic auth); SMTP stays for other providers.
export const provider: "graph" | "smtp" | null = graphConfigured ? "graph" : config.smtp.host ? "smtp" : null;
export const mailConfigured = provider !== null;

const transport =
  provider === "smtp"
    ? nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      })
    : null;

export function providerInfo() {
  if (provider === "graph") return { provider, label: "Microsoft 365 (Graph API)", from: fromAddress(config.mailFrom) };
  if (provider === "smtp") return { provider, label: `SMTP ${config.smtp.host}:${config.smtp.port}`, from: config.mailFrom };
  return { provider: null, label: "Not configured", from: config.mailFrom };
}

/** Checks mail connectivity/credentials at startup so misconfiguration shows up in the logs. */
export async function verifyMail() {
  const info = providerInfo();
  if (!provider) {
    console.warn("[notify] email not configured — issue emails will be logged as 'skipped'. Set GRAPH_* (Microsoft 365) or SMTP_* in .env");
    return;
  }
  try {
    if (provider === "graph") await graphVerify();
    else await transport!.verify();
    console.log(`[notify] ${info.label} ready, sending as ${info.from}`);
  } catch (e) {
    console.error(`[notify] ${info.label} check failed: ${(e as Error).message}`);
  }
}

/** Per-recipient time zone: manual choice → Outlook setting (Graph) → ALERT_TIMEZONE → UTC. */
export async function resolveTimezone(r: { email: string; timezone?: string | null }) {
  if (r.timezone && isValidTz(r.timezone)) return { tz: r.timezone, source: "manual" as const };
  const outlook = await outlookTimezone(r.email);
  if (outlook) return { tz: outlook, source: "outlook" as const };
  return { tz: isValidTz(config.alertTimezone) ? config.alertTimezone : "UTC", source: "default" as const };
}

const normEmail = (e: string) => e.trim().toLowerCase();
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function envRecipients() {
  return config.smtp.to.split(/[,;\s]+/).map(normEmail).filter((e) => EMAIL_RE.test(e));
}

export async function recipients(): Promise<{ email: string; timezone: string | null }[]> {
  const db = await prisma.notificationRecipient.findMany({ where: { enabled: true }, select: { email: true, timezone: true } });
  const out = new Map<string, { email: string; timezone: string | null }>();
  for (const r of db) out.set(normEmail(r.email), { email: normEmail(r.email), timezone: r.timezone });
  for (const e of envRecipients()) if (!out.has(e)) out.set(e, { email: e, timezone: null });
  return [...out.values()];
}

export function formatTime(d: Date, tz = isValidTz(config.alertTimezone) ? config.alertTimezone : "UTC") {
  const local = new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "long" }).format(d);
  return tz === "UTC" ? local : `${local} (${d.toISOString().replace("T", " ").slice(0, 19)} UTC)`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function buildEmail(ev: IssueEvent, tz?: string) {
  const meta = META[ev.type];
  const tone = TONE[meta.tone];
  const subject =
    meta.tone === "resolved"
      ? `[DevMonitor] ${meta.icon} Resolved: ${ev.service.name} — ${meta.label.toLowerCase()}`
      : `[DevMonitor] ${meta.icon} ${meta.label}: ${ev.service.name}`;

  const rows: [string, string][] = [
    ["Issue type", meta.label],
    ["Affected service", `${ev.service.name} (${ev.service.kind}${ev.service.environment ? ` · ${ev.service.environment}` : ""})`],
    ...(ev.service.url ? ([["Endpoint", ev.service.url]] as [string, string][]) : []),
    ["Timestamp", formatTime(ev.occurredAt, tz)],
    ...(ev.details ?? []).map(([k, v]) => [k, v instanceof Date ? formatTime(v, tz) : v] as [string, string]),
  ];

  const text = [
    `${tone.word.toUpperCase()} — ${meta.label}`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(ev.error ? ["", "Error details:", ev.error] : []),
    ...(ev.link ? ["", `Open in DevMonitor: ${ev.link}`] : []),
    "",
    "— Veganext DevMonitor. You receive this because you are on the DevMonitor admin alert list.",
  ].join("\n");

  const rowHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:9px 0;color:#6b7076;font-size:13px;width:150px;vertical-align:top;border-bottom:1px solid #eef0f2">${esc(k)}</td>` +
        `<td style="padding:9px 0;color:#1f2428;font-size:14px;font-weight:600;border-bottom:1px solid #eef0f2;word-break:break-word">${esc(v)}</td></tr>`
    )
    .join("");

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f3f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e1e6ea">
  <tr><td style="background:linear-gradient(135deg,#0f4a66,#2b7fa0);background-color:#0f4a66;padding:18px 24px;color:#ffffff">
    <div style="font-size:16px;font-weight:700;letter-spacing:-0.01em">DevMonitor</div>
    <div style="font-size:11px;opacity:.8;letter-spacing:.08em;text-transform:uppercase">Veganext</div>
  </td></tr>
  <tr><td style="padding:24px 24px 6px">
    <div style="display:inline-block;padding:4px 12px;border-radius:99px;background:${tone.soft};color:${tone.color};font-size:12px;font-weight:700;letter-spacing:.03em;text-transform:uppercase">${esc(tone.word)}</div>
    <h1 style="margin:12px 0 4px;font-size:22px;line-height:1.3;color:#1f2428;letter-spacing:-0.02em">${meta.icon} ${esc(meta.label)}: ${esc(ev.service.name)}</h1>
  </td></tr>
  <tr><td style="padding:6px 24px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowHtml}</table></td></tr>
  ${
    ev.error
      ? `<tr><td style="padding:14px 24px 4px"><div style="font-size:13px;color:#6b7076;margin-bottom:6px">Error details</div>
    <div style="background:${tone.soft};border-left:4px solid ${tone.color};border-radius:8px;padding:12px 14px;font-family:Menlo,Consolas,monospace;font-size:13px;color:#1f2428;white-space:pre-wrap;word-break:break-word">${esc(ev.error)}</div></td></tr>`
      : ""
  }
  ${
    ev.link
      ? `<tr><td style="padding:22px 24px 8px"><a href="${esc(ev.link)}" style="display:inline-block;background:#1b6a8c;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px">Open in DevMonitor →</a></td></tr>`
      : ""
  }
  <tr><td style="padding:18px 24px 22px;color:#8d9aa4;font-size:12px;line-height:1.5;border-top:1px solid #eef0f2">
    You receive this because you are on the DevMonitor admin alert list. Manage recipients under Notifications in DevMonitor.
  </td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRY_DELAYS_MS = [0, 5_000, 30_000];

async function sendOnce(to: string, mail: { subject: string; text: string; html: string }) {
  if (provider === "graph") return graphSendMail(to, mail);
  await transport!.sendMail({ from: config.mailFrom, to, ...mail });
}

function isPermanent(e: unknown) {
  if (e instanceof GraphError) return e.permanent;
  // SMTP 5xx (e.g. unknown mailbox, auth rejected) won't succeed on retry.
  return /^5\d\d/.test(String((e as { responseCode?: number }).responseCode ?? ""));
}

async function deliver(to: string, mail: { subject: string; text: string; html: string }, delays: number[]): Promise<DeliveryResult> {
  if (!provider) return { recipient: to, status: "skipped", attempts: 0, error: "Email not configured" };
  let lastErr = "";
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await sleep(delays[i]);
    try {
      await sendOnce(to, mail);
      return { recipient: to, status: "sent", attempts: i + 1 };
    } catch (e) {
      lastErr = (e as Error).message;
      if (isPermanent(e)) return { recipient: to, status: "failed", attempts: i + 1, error: lastErr };
    }
  }
  return { recipient: to, status: "failed", attempts: delays.length, error: lastErr };
}

/**
 * Emails every enabled admin about an issue and records each outcome. Never throws.
 * `retry: false` makes a single attempt (used by the interactive test button so it answers quickly).
 */
export async function notifyNow(
  ev: IssueEvent,
  { retry = true, only }: { retry?: boolean; only?: string[] } = {}
): Promise<DeliveryResult[]> {
  try {
    let to = await recipients();
    if (only?.length) {
      const want = new Set(only.map(normEmail));
      const known = new Map(to.map((r) => [r.email, r]));
      to = [...want].map((e) => known.get(e) ?? { email: e, timezone: null });
    }
    const subject = buildEmail(ev).subject;
    if (!to.length) {
      console.warn(`[notify] no enabled recipients for "${subject}"`);
      return [];
    }
    const results = await Promise.all(
      to.map(async (r) => {
        const { tz } = await resolveTimezone(r);
        return deliver(r.email, buildEmail(ev, tz), retry ? RETRY_DELAYS_MS : [0]);
      })
    );
    await prisma.notificationLog.createMany({
      data: results.map((r) => ({
        event: ev.type,
        subject,
        service: ev.service.name,
        recipient: r.recipient,
        status: r.status,
        attempts: r.attempts,
        error: r.error ?? null,
        incidentId: ev.incidentId ?? null,
      })),
    });
    const sent = results.filter((r) => r.status === "sent").length;
    console.log(`[notify] ${subject} → ${sent}/${results.length} sent`);
    return results;
  } catch (e) {
    console.error("[notify] failed:", (e as Error).message);
    return [];
  }
}

/** Fire-and-forget variant for the checker: retries must not delay the next check cycle. */
export function notify(ev: IssueEvent) {
  void notifyNow(ev);
}
