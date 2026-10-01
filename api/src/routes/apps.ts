import { Router } from "express";
import { prisma } from "../db";
import { requireAdmin } from "../auth";
import { probe, runCheck } from "../checker";
import { downsample, parseRange } from "../range";

export const appsRouter = Router();
appsRouter.use(requireAdmin);

function parseBody(b: any, partial = false) {
  const data: Record<string, unknown> = {};
  const err = (m: string) => {
    throw new Error(m);
  };
  if (!partial || b.name !== undefined) {
    if (typeof b.name !== "string" || !b.name.trim()) err("Name is required");
    data.name = b.name.trim();
  }
  if (!partial || b.url !== undefined) {
    try {
      const u = new URL(b.url);
      if (!/^https?:$/.test(u.protocol)) throw 0;
      data.url = u.toString();
    } catch {
      err("A valid http(s) URL is required");
    }
  }
  if (b.healthUrl !== undefined) {
    const h = typeof b.healthUrl === "string" ? b.healthUrl.trim() : "";
    if (!h) data.healthUrl = null;
    else if (h.startsWith("/")) data.healthUrl = h;
    else {
      try {
        const u = new URL(h);
        if (!/^https?:$/.test(u.protocol)) throw 0;
        data.healthUrl = u.toString();
      } catch {
        err("Health-check endpoint must be a path like /health or a full http(s) URL");
      }
    }
  }
  if (b.description !== undefined) data.description = b.description ? String(b.description) : null;
  if (b.kind !== undefined) data.kind = ["web", "api", "service"].includes(b.kind) ? b.kind : "web";
  if (b.environment !== undefined) data.environment = ["production", "staging", "dev"].includes(b.environment) ? b.environment : "production";
  if (b.method !== undefined) data.method = ["GET", "HEAD", "POST"].includes(b.method) ? b.method : "GET";
  if (b.expectedStatus !== undefined) data.expectedStatus = Math.min(599, Math.max(100, Number(b.expectedStatus) || 200));
  if (b.timeoutMs !== undefined) data.timeoutMs = Math.min(60000, Math.max(1000, Number(b.timeoutMs) || 10000));
  if (b.enabled !== undefined) data.enabled = Boolean(b.enabled);
  if (b.insecureTls !== undefined) data.insecureTls = Boolean(b.insecureTls);
  if (b.serverId !== undefined) data.serverId = b.serverId || null;
  return data;
}

appsRouter.get("/", async (_req, res) => {
  const apps = await prisma.app.findMany({
    orderBy: { name: "asc" },
    include: { server: { select: { id: true, name: true } } },
  });
  const since = new Date(Date.now() - 24 * 3600e3);
  const stats = await prisma.check.groupBy({ by: ["appId", "ok"], where: { createdAt: { gte: since } }, _count: true });
  const out = apps.map((a) => {
    const up = stats.find((s) => s.appId === a.id && s.ok)?._count ?? 0;
    const down = stats.find((s) => s.appId === a.id && !s.ok)?._count ?? 0;
    return { ...a, uptime24h: up + down ? (up / (up + down)) * 100 : null };
  });
  res.json(out);
});

appsRouter.post("/", async (req, res) => {
  try {
    const app = await prisma.app.create({ data: parseBody(req.body) as any });
    runCheck(app).catch(() => {});
    res.status(201).json(app);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// Ping a configuration before saving it (used by the "Ping" button on the app form).
appsRouter.post("/test", async (req, res) => {
  try {
    const d = parseBody({ name: "test", ...req.body });
    const result = await probe({
      url: d.url as string,
      healthUrl: (d.healthUrl as string | null | undefined) ?? null,
      method: (d.method as string) ?? "GET",
      expectedStatus: (d.expectedStatus as number) ?? 200,
      timeoutMs: (d.timeoutMs as number) ?? 10000,
      insecureTls: Boolean(d.insecureTls),
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

appsRouter.get("/:id", async (req, res) => {
  const app = await prisma.app.findUnique({
    where: { id: req.params.id },
    include: { server: { select: { id: true, name: true } } },
  });
  if (!app) return res.status(404).json({ error: "Not found" });
  const { since, bucketMs } = parseRange(req.query.range);
  const [checks, incidents] = await Promise.all([
    prisma.check.findMany({ where: { appId: app.id, createdAt: { gte: since } }, orderBy: { createdAt: "asc" } }),
    prisma.incident.findMany({ where: { appId: app.id }, orderBy: { startedAt: "desc" }, take: 20 }),
  ]);
  const okCount = checks.filter((c) => c.ok).length;
  const lat = checks.filter((c) => c.ok && c.latencyMs != null).map((c) => c.latencyMs as number).sort((a, b) => a - b);
  res.json({
    app,
    summary: {
      uptime: checks.length ? (okCount / checks.length) * 100 : null,
      checks: checks.length,
      avgLatency: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null,
      p95Latency: lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] : null,
    },
    series: downsample(
      checks.map((c) => ({ createdAt: c.createdAt, latencyMs: c.latencyMs, up: c.ok ? 100 : 0 })),
      bucketMs,
      ["latencyMs", "up"]
    ),
    recent: checks.slice(-30).reverse(),
    incidents,
  });
});

appsRouter.patch("/:id", async (req, res) => {
  try {
    const app = await prisma.app.update({ where: { id: req.params.id }, data: parseBody(req.body, true) as any });
    res.json(app);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

appsRouter.delete("/:id", async (req, res) => {
  await prisma.app.delete({ where: { id: req.params.id } }).catch(() => {});
  res.json({ ok: true });
});

appsRouter.post("/:id/check", async (req, res) => {
  const app = await prisma.app.findUnique({ where: { id: req.params.id } });
  if (!app) return res.status(404).json({ error: "Not found" });
  res.json(await runCheck(app));
});
