import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { config } from "./config";
import { prisma } from "./db";

export const COOKIE = "dm_session";
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export type Role = "admin" | "staff";
export type SessionUser = { id: string; username: string; role: Role };

// Non-admin accounts are blocked after this many consecutive wrong passwords, until an admin unblocks them.
export const MAX_FAILED_ATTEMPTS = 3;

// Compared against when the username is unknown, so response time doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const toSessionUser = (u: { id: string; username: string; role: string }): SessionUser => ({
  id: u.id,
  username: u.username,
  role: u.role === "admin" ? "admin" : "staff",
});

/** Usernames are stored lowercase: 3–32 letters, digits, dots, dashes or underscores. */
export const normalizeUsername = (u: string) => u.trim().toLowerCase();
export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

/**
 * Seeds accounts from .env. Accounts are managed on the Users page, so .env is only used:
 *  - on first start (no accounts yet): ADMIN_USER and STAFF_USER are created;
 *  - for recovery: if no admin account exists any more, ADMIN_USER is (re)created as admin.
 */
export async function ensureUsers() {
  const admin = { username: normalizeUsername(config.adminUser), passwordHash: config.adminPasswordHash, role: "admin" as Role };
  const staff = { username: normalizeUsername(config.staffUser), passwordHash: config.staffPasswordHash, role: "staff" as Role };

  if ((await prisma.user.count()) === 0) {
    for (const a of [admin, staff]) {
      if (!a.username || !a.passwordHash) continue;
      await prisma.user.create({ data: a });
      console.log(`[auth] created ${a.role} account "${a.username}" from .env`);
    }
    return;
  }
  if (admin.username && admin.passwordHash && (await prisma.user.count({ where: { role: "admin" } })) === 0) {
    const reset = { passwordHash: admin.passwordHash, role: admin.role, blockedAt: null, blockedBy: null, failedAttempts: 0, tokenVersion: { increment: 1 } };
    await prisma.user.upsert({ where: { username: admin.username }, create: admin, update: reset });
    console.log(`[auth] no admin account found — restored "${admin.username}" from .env`);
  }
}

export type LoginResult = { ok: true; user: SessionUser & { tokenVersion: number } } | { ok: false; reason: "invalid" | "blocked" | "blocked_by_admin" };

export async function verifyLogin(rawUsername: string, password: string): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { username: normalizeUsername(rawUsername) } });
  const passOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user) return { ok: false, reason: "invalid" };

  const lockable = user.role !== "admin";
  if (lockable && user.blockedAt) return { ok: false, reason: user.blockedBy ? "blocked_by_admin" : "blocked" };

  if (!passOk) {
    if (!lockable) return { ok: false, reason: "invalid" };
    const u = await prisma.user.update({ where: { id: user.id }, data: { failedAttempts: { increment: 1 } } });
    if (u.failedAttempts < MAX_FAILED_ATTEMPTS) return { ok: false, reason: "invalid" };
    await prisma.user.updateMany({ where: { id: user.id, blockedAt: null }, data: { blockedAt: new Date(), blockedBy: null } });
    return { ok: false, reason: "blocked" };
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lastLoginAt: new Date() } });
  return { ok: true, user: { ...toSessionUser(user), tokenVersion: user.tokenVersion } };
}

export function issueSession(res: Response, user: { id: string; tokenVersion: number }) {
  const token = jwt.sign({ sub: user.id, v: user.tokenVersion }, config.sessionSecret, { expiresIn: "7d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicWebUrl.startsWith("https://"),
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

/** Resolves the session cookie to an account that still exists, isn't blocked and hasn't changed password since. */
export async function readSession(req: Request): Promise<SessionUser | null> {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  let claims: { sub: string; v?: number };
  try {
    claims = jwt.verify(token, config.sessionSecret) as { sub: string; v?: number };
  } catch {
    return null;
  }
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user || user.tokenVersion !== claims.v || (user.role !== "admin" && user.blockedAt)) return null;
  return toSessionUser(user);
}

export const currentUser = (req: Request) => (req as Request & { user: SessionUser }).user;

/** Any signed-in account (admin or staff). */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await readSession(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    (req as Request & { user: SessionUser }).user = user;
    next();
  } catch (e) {
    next(e);
  }
}

/** Use after requireAuth. */
export const requireRole = (role: Role) => (req: Request, res: Response, next: NextFunction) => {
  if (currentUser(req)?.role !== role) return res.status(403).json({ error: "You don't have permission to do this" });
  next();
};

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const newApiKey = () => "dm_" + crypto.randomBytes(24).toString("hex");

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
