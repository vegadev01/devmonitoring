import { Router } from "express";
import { prisma } from "../db";
import { newApiKey, requireAdmin, safeEqual, sha256 } from "../auth";
import { config } from "../config";
import { downsample, parseRange } from "../range";

export const serversRouter = Router();

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Agent endpoint — authenticated by API key, not by admin session.
serversRouter.post("/:id/metrics", async (req, res) => {
  const key = req.header("x-api-key");
  const server = await prisma.server.findUnique({ where: { id: req.params.id } });
  if (!server || !key || !safeEqual(sha256(key), server.apiKeyHash)) return res.status(401).json({ error: "Invalid credentials" });
  const b = req.body ?? {};
  await prisma.$transaction([
    prisma.metric.create({
      data: {
        serverId: server.id,
        cpuPct: num(b.cpuPct),
        ramPct: num(b.ramPct),
        gpuPct: num(b.gpuPct),
        diskPct: num(b.diskPct),
        netRxBytes: num(b.netRxBytes),
        netTxBytes: num(b.netTxBytes),
      },
    }),
    prisma.server.update({ where: { id: server.id }, data: { lastSeenAt: new Date() } }),
  ]);
  res.status(201).json({ ok: true });
});

serversRouter.use(requireAdmin);

function withStatus<T extends { lastSeenAt: Date | null }>(s: T) {
  const online = !!s.lastSeenAt && Date.now() - s.lastSeenAt.getTime() <= config.serverOfflineAfterMs;
  return { ...s, status: !s.lastSeenAt ? "pending" : online ? "online" : "offline" };
}

serversRouter.get("/", async (_req, res) => {
  const servers = await prisma.server.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, hostname: true, lastSeenAt: true, createdAt: true, _count: { select: { apps: true } } },
  });
  const latest = await Promise.all(
    servers.map((s) => prisma.metric.findFirst({ where: { serverId: s.id }, orderBy: { createdAt: "desc" } }))
  );
  res.json(servers.map((s, i) => ({ ...withStatus(s), latest: latest[i] })));
});

serversRouter.post("/", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "Name is required" });
  const apiKey = newApiKey();
  const server = await prisma.server.create({
    data: { name, hostname: req.body?.hostname ? String(req.body.hostname) : null, apiKeyHash: sha256(apiKey) },
  });
  const api = config.publicApiUrl.replace(/\/$/, "");
  res.status(201).json({
    id: server.id,
    name: server.name,
    apiKey, // shown exactly once
    installCommand: `curl -fsSL ${api}/agent/install.sh | sudo SERVER_ID="${server.id}" API_KEY="${apiKey}" API_URL="${api}" bash`,
  });
});

serversRouter.get("/:id", async (req, res) => {
  const server = await prisma.server.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, name: true, hostname: true, lastSeenAt: true, createdAt: true,
      apps: { select: { id: true, name: true, status: true, url: true } },
    },
  });
  if (!server) return res.status(404).json({ error: "Not found" });
  const { since, bucketMs } = parseRange(req.query.range);
  const [metrics, latest, incidents] = await Promise.all([
    prisma.metric.findMany({ where: { serverId: server.id, createdAt: { gte: since } }, orderBy: { createdAt: "asc" } }),
    prisma.metric.findFirst({ where: { serverId: server.id }, orderBy: { createdAt: "desc" } }),
    prisma.incident.findMany({ where: { serverId: server.id }, orderBy: { startedAt: "desc" }, take: 20 }),
  ]);
  res.json({
    server: withStatus(server),
    latest,
    incidents,
    series: downsample(metrics, bucketMs, ["cpuPct", "ramPct", "gpuPct", "diskPct", "netRxBytes", "netTxBytes"]),
  });
});

serversRouter.delete("/:id", async (req, res) => {
  await prisma.server.delete({ where: { id: req.params.id } }).catch(() => {});
  res.json({ ok: true });
});

serversRouter.post("/:id/rotate-key", async (req, res) => {
  const apiKey = newApiKey();
  try {
    await prisma.server.update({ where: { id: req.params.id }, data: { apiKeyHash: sha256(apiKey) } });
  } catch {
    return res.status(404).json({ error: "Not found" });
  }
  res.json({ apiKey });
});
