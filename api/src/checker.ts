import cron from "node-cron";
import type { App } from "@prisma/client";
import { prisma } from "./db";
import { config } from "./config";
import { notify } from "./notify";
import { describeError, send } from "./httpclient";

export type ProbeTarget = Pick<App, "url" | "healthUrl" | "method" | "expectedStatus" | "timeoutMs" | "insecureTls">;

/** The URL that is actually probed: the health endpoint if set (absolute, or a path relative to the app URL). */
export function checkUrl(t: Pick<App, "url" | "healthUrl">) {
  return t.healthUrl ? new URL(t.healthUrl, t.url).toString() : t.url;
}

/** Runs one health probe without touching the database. */
export async function probe(t: ProbeTarget) {
  const target = checkUrl(t);
  const started = Date.now();
  try {
    const res = await send({ method: t.method, url: target, insecureTls: t.insecureTls, timeoutMs: t.timeoutMs });
    const ok = res.status === t.expectedStatus || (t.expectedStatus === 200 && res.status < 400);
    return { ok, statusCode: res.status, latencyMs: res.timeMs, error: ok ? null : `Expected ${t.expectedStatus}, got ${res.status}`, url: target };
  } catch (e) {
    return { ok: false, statusCode: null, latencyMs: Date.now() - started, error: describeError(e), url: target };
  }
}

export async function runCheck(app: App) {
  const { ok, statusCode, latencyMs, error } = await probe(app);

  await prisma.check.create({ data: { appId: app.id, ok, statusCode, latencyMs, error } });
  const newStatus = ok ? "up" : "down";
  await prisma.app.update({
    where: { id: app.id },
    data: { status: newStatus, lastCheckedAt: new Date(), lastLatencyMs: latencyMs },
  });

  const open = await prisma.incident.findFirst({ where: { appId: app.id, resolvedAt: null } });
  const service = { kind: "Application" as const, name: app.name, environment: app.environment, url: checkUrl(app) };
  const link = `${config.publicWebUrl}/apps/${app.id}`;
  if (!ok && !open) {
    // Require two consecutive failures to avoid flapping on a single blip.
    const last2 = await prisma.check.findMany({ where: { appId: app.id }, orderBy: { createdAt: "desc" }, take: 2 });
    if (last2.length === 2 && last2.every((c) => !c.ok)) {
      const incident = await prisma.incident.create({ data: { kind: "app", appId: app.id, reason: error ?? "Check failed" } });
      notify({
        type: "app_down",
        service,
        occurredAt: incident.startedAt,
        error,
        details: [
          ["HTTP status", statusCode == null ? "No response" : String(statusCode)],
          ["Expected", `HTTP ${app.expectedStatus} within ${app.timeoutMs / 1000}s`],
          ["Failed checks", "2 consecutive"],
          ["Response time", `${latencyMs} ms`],
        ],
        link,
        incidentId: incident.id,
      });
    }
  } else if (ok && open) {
    const resolvedAt = new Date();
    await prisma.incident.update({ where: { id: open.id }, data: { resolvedAt } });
    notify({
      type: "app_recovered",
      service,
      occurredAt: resolvedAt,
      details: [
        ["Down since", open.startedAt],
        ["Downtime", humanDuration(resolvedAt.getTime() - open.startedAt.getTime())],
        ["Original error", open.reason],
        ["HTTP status", String(statusCode)],
        ["Response time", `${latencyMs} ms`],
      ],
      link,
      incidentId: open.id,
    });
  }
  return { ok, statusCode, latencyMs, error };
}

async function checkServers() {
  const servers = await prisma.server.findMany();
  const now = Date.now();
  for (const s of servers) {
    const stale = !s.lastSeenAt || now - s.lastSeenAt.getTime() > config.serverOfflineAfterMs;
    const open = await prisma.incident.findFirst({ where: { serverId: s.id, resolvedAt: null } });
    const service = { kind: "Server" as const, name: s.name, ...(s.hostname ? { url: s.hostname } : {}) };
    const link = `${config.publicWebUrl}/servers/${s.id}`;
    if (stale && s.lastSeenAt && !open) {
      const incident = await prisma.incident.create({ data: { kind: "server", serverId: s.id, reason: "No metrics received from agent" } });
      notify({
        type: "server_offline",
        service,
        occurredAt: incident.startedAt,
        error: `The monitoring agent has not reported for ${humanDuration(now - s.lastSeenAt.getTime())} (threshold ${humanDuration(config.serverOfflineAfterMs)}). The server may be down, unreachable, or the agent stopped.`,
        details: [["Last report", s.lastSeenAt]],
        link,
        incidentId: incident.id,
      });
    } else if (!stale && open) {
      const resolvedAt = new Date();
      await prisma.incident.update({ where: { id: open.id }, data: { resolvedAt } });
      notify({
        type: "server_recovered",
        service,
        occurredAt: resolvedAt,
        details: [
          ["Offline since", open.startedAt],
          ["Offline for", humanDuration(resolvedAt.getTime() - open.startedAt.getTime())],
        ],
        link,
        incidentId: open.id,
      });
    }
  }
}

function humanDuration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}min`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// A broken check loop is itself an issue; alert at most once an hour so a persistent fault doesn't spam.
let lastSystemAlert = 0;
function reportSystemError(e: unknown) {
  const msg = (e as Error).message ?? String(e);
  console.error("[checker] run failed:", msg);
  if (Date.now() - lastSystemAlert < 3600_000) return;
  lastSystemAlert = Date.now();
  notify({
    type: "system_error",
    service: { kind: "System", name: "DevMonitor checker" },
    occurredAt: new Date(),
    error: msg,
    details: [["Impact", "Health checks may not be running until this is fixed"]],
    link: config.publicWebUrl,
  });
}

let running = false;
export async function runAllChecks() {
  if (running) return;
  running = true;
  try {
    const apps = await prisma.app.findMany({ where: { enabled: true } });
    await Promise.allSettled(apps.map((a) => runCheck(a)));
    await checkServers();
  } catch (e) {
    reportSystemError(e);
  } finally {
    running = false;
  }
}

export function startChecker() {
  console.log(`[checker] running every ${config.checkIntervalMs}ms`);
  setTimeout(runAllChecks, 3000);
  setInterval(runAllChecks, config.checkIntervalMs);
  // Nightly retention cleanup.
  cron.schedule("17 3 * * *", async () => {
    const cutoff = new Date(Date.now() - config.retentionDays * 86400_000);
    const [c, m] = await Promise.all([
      prisma.check.deleteMany({ where: { createdAt: { lt: cutoff } } }),
      prisma.metric.deleteMany({ where: { createdAt: { lt: cutoff } } }),
      prisma.notificationLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    ]);
    console.log(`[retention] removed ${c.count} checks, ${m.count} metrics`);
  });
}
