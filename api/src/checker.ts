import cron from "node-cron";
import type { App } from "@prisma/client";
import { prisma } from "./db";
import { config } from "./config";
import { sendAlert } from "./mailer";
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
  if (!ok && !open) {
    // Require two consecutive failures to avoid flapping on a single blip.
    const last2 = await prisma.check.findMany({ where: { appId: app.id }, orderBy: { createdAt: "desc" }, take: 2 });
    if (last2.length === 2 && last2.every((c) => !c.ok)) {
      await prisma.incident.create({ data: { kind: "app", appId: app.id, reason: error ?? "Check failed" } });
      await sendAlert(`🔴 ${app.name} is DOWN`, `${app.name} (${checkUrl(app)}) is failing.\nReason: ${error}\n\n${config.publicWebUrl}/apps/${app.id}`);
    }
  } else if (ok && open) {
    await prisma.incident.update({ where: { id: open.id }, data: { resolvedAt: new Date() } });
    await sendAlert(`🟢 ${app.name} recovered`, `${app.name} (${app.url}) is back up (${latencyMs}ms).\n\n${config.publicWebUrl}/apps/${app.id}`);
  }
  return { ok, statusCode, latencyMs, error };
}

async function checkServers() {
  const servers = await prisma.server.findMany();
  const now = Date.now();
  for (const s of servers) {
    const stale = !s.lastSeenAt || now - s.lastSeenAt.getTime() > config.serverOfflineAfterMs;
    const open = await prisma.incident.findFirst({ where: { serverId: s.id, resolvedAt: null } });
    if (stale && s.lastSeenAt && !open) {
      await prisma.incident.create({ data: { kind: "server", serverId: s.id, reason: "No metrics received from agent" } });
      await sendAlert(`🔴 Server ${s.name} is offline`, `No metrics received since ${s.lastSeenAt.toISOString()}.\n\n${config.publicWebUrl}/servers/${s.id}`);
    } else if (!stale && open) {
      await prisma.incident.update({ where: { id: open.id }, data: { resolvedAt: new Date() } });
      await sendAlert(`🟢 Server ${s.name} is back online`, `Agent is reporting again.\n\n${config.publicWebUrl}/servers/${s.id}`);
    }
  }
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
    console.error("[checker] run failed:", (e as Error).message);
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
    ]);
    console.log(`[retention] removed ${c.count} checks, ${m.count} metrics`);
  });
}
