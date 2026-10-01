import cron from "node-cron";
import http from "node:http";
import https from "node:https";
import type { App } from "@prisma/client";
import { prisma } from "./db";
import { config } from "./config";
import { sendAlert } from "./mailer";

// Used only for apps flagged insecureTls: fetch() can't skip certificate verification per request.
function probeInsecure(app: App, url = app.url, hops = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === "https:" ? https : http).request(
      u,
      { method: app.method, rejectUnauthorized: false, headers: { "User-Agent": "VeganextDevMonitor/1.0" } },
      (res) => {
        res.resume();
        const loc = res.headers.location;
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc && hops < 5) {
          resolve(probeInsecure(app, new URL(loc, u).toString(), hops + 1));
        } else resolve(res.statusCode ?? 0);
      }
    );
    req.setTimeout(app.timeoutMs, () => req.destroy(Object.assign(new Error(`Timed out after ${app.timeoutMs}ms`), { name: "TimeoutError" })));
    req.on("error", reject);
    req.end();
  });
}

export async function runCheck(app: App) {
  const started = Date.now();
  let ok = false;
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    if (app.insecureTls) {
      statusCode = await probeInsecure(app);
    } else {
      const res = await fetch(app.url, {
        method: app.method,
        redirect: "follow",
        signal: AbortSignal.timeout(app.timeoutMs),
        headers: { "User-Agent": "VeganextDevMonitor/1.0" },
      });
      statusCode = res.status;
      await res.body?.cancel().catch(() => {});
    }
    ok = statusCode === app.expectedStatus || (app.expectedStatus === 200 && statusCode < 400);
    if (!ok) error = `Expected ${app.expectedStatus}, got ${statusCode}`;
  } catch (e) {
    const err = e as Error;
    error = err.name === "TimeoutError" ? `Timed out after ${app.timeoutMs}ms` : err.cause ? String((err.cause as Error).message ?? err.message) : err.message;
  }
  const latencyMs = Date.now() - started;

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
      await sendAlert(`🔴 ${app.name} is DOWN`, `${app.name} (${app.url}) is failing.\nReason: ${error}\n\n${config.publicWebUrl}/apps/${app.id}`);
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
