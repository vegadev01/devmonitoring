import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { config } from "./config";
import { startChecker } from "./checker";
import { authRouter } from "./routes/auth";
import { appsRouter } from "./routes/apps";
import { serversRouter } from "./routes/servers";
import { overviewRouter } from "./routes/overview";
import { studioRouter } from "./routes/studio";

const app = express();
app.set("trust proxy", true);
app.use("/studio", cookieParser(), studioRouter);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/agent", express.static(path.join(__dirname, "../public/agent")));

app.use("/auth", authRouter);
app.use("/apps", appsRouter);
app.use("/servers", serversRouter);
app.use("/", overviewRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`[api] listening on :${config.port}`);
  startChecker();
});
