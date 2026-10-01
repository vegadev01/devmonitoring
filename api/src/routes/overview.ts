import { Router } from "express";
import { prisma } from "../db";
import { requireAdmin } from "../auth";
import { config } from "../config";

export const overviewRouter = Router();
overviewRouter.use(requireAdmin);

overviewRouter.get("/overview", async (_req, res) => {
  const since = new Date(Date.now() - 24 * 3600e3);
  const offlineCut = Date.now() - config.serverOfflineAfterMs;
  const [apps, servers, openIncidents, checks, recent] = await Promise.all([
    prisma.app.findMany({ select: { id: true, status: true, enabled: true } }),
    prisma.server.findMany({ select: { id: true, lastSeenAt: true } }),
    prisma.incident.count({ where: { resolvedAt: null } }),
    prisma.check.findMany({ where: { createdAt: { gte: since } }, select: { ok: true, latencyMs: true, createdAt: true } }),
    prisma.incident.findMany({
      orderBy: { startedAt: "desc" },
      take: 6,
      include: { app: { select: { id: true, name: true } }, server: { select: { id: true, name: true } } },
    }),
  ]);

  // Hourly fleet-wide uptime + latency for the last 24h.
  const hours = new Map<number, { ok: number; n: number; lat: number; latN: number }>();
  for (const c of checks) {
    const k = Math.floor(c.createdAt.getTime() / 3600e3) * 3600e3;
    const h = hours.get(k) ?? { ok: 0, n: 0, lat: 0, latN: 0 };
    h.n++;
    if (c.ok) {
      h.ok++;
      if (c.latencyMs != null) { h.lat += c.latencyMs; h.latN++; }
    }
    hours.set(k, h);
  }
  const okCount = checks.filter((c) => c.ok).length;
  const lats = checks.filter((c) => c.ok && c.latencyMs != null);

  res.json({
    apps: {
      total: apps.length,
      up: apps.filter((a) => a.status === "up").length,
      down: apps.filter((a) => a.status === "down").length,
      unknown: apps.filter((a) => a.status === "unknown").length,
    },
    servers: {
      total: servers.length,
      online: servers.filter((s) => s.lastSeenAt && s.lastSeenAt.getTime() >= offlineCut).length,
    },
    openIncidents,
    uptime24h: checks.length ? (okCount / checks.length) * 100 : null,
    avgLatency24h: lats.length ? lats.reduce((a, c) => a + (c.latencyMs as number), 0) / lats.length : null,
    series: [...hours.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, h]) => ({ t, uptime: (h.ok / h.n) * 100, latencyMs: h.latN ? h.lat / h.latN : null })),
    recentIncidents: recent,
  });
});

overviewRouter.get("/incidents", async (_req, res) => {
  const incidents = await prisma.incident.findMany({
    orderBy: { startedAt: "desc" },
    take: 100,
    include: { app: { select: { id: true, name: true } }, server: { select: { id: true, name: true } } },
  });
  res.json(incidents);
});
