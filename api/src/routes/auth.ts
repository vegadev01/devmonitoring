import { Router } from "express";
import { COOKIE, MAX_FAILED_ATTEMPTS, issueSession, readSession, verifyLogin } from "../auth";

export const authRouter = Router();

// Tiny in-memory throttle: 8 attempts / 10 min / IP. Applies to every account, admins included;
// non-admin accounts are additionally blocked after MAX_FAILED_ATTEMPTS wrong passwords.
const attempts = new Map<string, { n: number; reset: number }>();

authRouter.post("/login", async (req, res, next) => {
  try {
    const ip = req.ip || "unknown";
    const now = Date.now();
    const a = attempts.get(ip);
    if (a && a.reset > now && a.n >= 8) return res.status(429).json({ error: "Too many attempts. Try again later." });
    const { username, password } = req.body ?? {};
    const result = typeof username === "string" && typeof password === "string" ? await verifyLogin(username, password) : null;
    if (!result?.ok) {
      attempts.set(ip, a && a.reset > now ? { n: a.n + 1, reset: a.reset } : { n: 1, reset: now + 600_000 });
      if (result?.reason === "blocked") {
        return res.status(403).json({ error: `This account is blocked after ${MAX_FAILED_ATTEMPTS} failed sign-in attempts. Ask an admin to unblock it.` });
      }
      return res.status(401).json({ error: "Invalid username or password" });
    }
    attempts.delete(ip);
    issueSession(res, result.user);
    res.json({ user: result.user.username, role: result.user.role });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", async (req, res, next) => {
  try {
    const user = await readSession(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    res.json({ user: user.username, role: user.role });
  } catch (e) {
    next(e);
  }
});
