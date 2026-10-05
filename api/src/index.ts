import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { config } from "./config";
import { checkerState, startChecker } from "./checker";
import { prisma } from "./db";
import { authRouter } from "./routes/auth";
import { appsRouter } from "./routes/apps";
import { serversRouter } from "./routes/servers";
import { overviewRouter } from "./routes/overview";
import { studioRouter } from "./routes/studio";
import { notificationsRouter } from "./routes/notifications";
import { verifyMail } from "./notify";

const app = express();
app.set("trust proxy", true);
app.use("/studio", cookieParser(), studioRouter);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

// Public liveness/readiness probe used by deploys and the GitHub uptime workflow.
// Unhealthy (503) if the database is unreachable or the check loop has stalled.
app.get("/health", async (_req, res) => {
  const started = Date.now();
  let db = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = false;
  }
  const last = checkerState.lastRunAt;
  const stale = last ? Date.now() - last.getTime() > config.checkIntervalMs * 3 + 60_000 : process.uptime() * 1000 > config.checkIntervalMs * 3 + 60_000;
  const ok = db && !stale;
  res.status(ok ? 200 : 503).json({
    ok,
    db,
    checker: { lastRunAt: last, stale },
    uptimeSec: Math.round(process.uptime()),
    responseMs: Date.now() - started,
  });
});
app.use("/agent", express.static(path.join(__dirname, "../public/agent")));

app.use("/auth", authRouter);
app.use("/apps", appsRouter);
app.use("/servers", serversRouter);
app.use("/notifications", notificationsRouter);
app.use("/", overviewRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`[api] listening on :${config.port}`);
  startChecker();
  verifyMail();
});
