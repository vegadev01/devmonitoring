import { Router } from "express";
import { COOKIE, issueSession, readSession, verifyLogin } from "../auth";

export const authRouter = Router();

// Tiny in-memory throttle: 8 attempts / 10 min / IP.
const attempts = new Map<string, { n: number; reset: number }>();

authRouter.post("/login", (req, res) => {
  const ip = req.ip || "unknown";
  const now = Date.now();
  const a = attempts.get(ip);
  if (a && a.reset > now && a.n >= 8) return res.status(429).json({ error: "Too many attempts. Try again later." });
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string" || !verifyLogin(username, password)) {
    attempts.set(ip, a && a.reset > now ? { n: a.n + 1, reset: a.reset } : { n: 1, reset: now + 600_000 });
    return res.status(401).json({ error: "Invalid username or password" });
  }
  attempts.delete(ip);
  issueSession(res, username);
  res.json({ user: username });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", (req, res) => {
  const user = readSession(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  res.json({ user });
});
