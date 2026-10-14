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

/**
 * Creates the admin/staff accounts named in .env, keeping their password and role in sync with it.
 * .env is the source of truth: accounts it no longer names (e.g. a renamed admin) are removed.
 */
export async function ensureUsers() {
  const accounts = ([
    { username: config.adminUser, passwordHash: config.adminPasswordHash, role: "admin" },
    { username: config.staffUser, passwordHash: config.staffPasswordHash, role: "staff" },
  ] as { username: string; passwordHash: string; role: Role }[]).filter((a) => a.username && a.passwordHash);
  if (!accounts.length) return;

  const { count } = await prisma.user.deleteMany({ where: { username: { notIn: accounts.map((a) => a.username) } } });
  if (count) console.log(`[auth] removed ${count} account(s) no longer configured in .env`);
  for (const a of accounts) {
    await prisma.user.upsert({
      where: { username: a.username },
      create: a,
      // Admins can never be blocked, so clear any lock left over from a previous role.
      update: { passwordHash: a.passwordHash, role: a.role, ...(a.role === "admin" ? { blockedAt: null, failedAttempts: 0 } : {}) },
    });
  }
}

export type LoginResult = { ok: true; user: SessionUser } | { ok: false; reason: "invalid" | "blocked" };

export async function verifyLogin(username: string, password: string): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { username } });
  const passOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user) return { ok: false, reason: "invalid" };

  const lockable = user.role !== "admin";
  if (lockable && user.blockedAt) return { ok: false, reason: "blocked" };

  if (!passOk) {
    if (!lockable) return { ok: false, reason: "invalid" };
    const u = await prisma.user.update({ where: { id: user.id }, data: { failedAttempts: { increment: 1 } } });
    if (u.failedAttempts < MAX_FAILED_ATTEMPTS) return { ok: false, reason: "invalid" };
    await prisma.user.updateMany({ where: { id: user.id, blockedAt: null }, data: { blockedAt: new Date() } });
    return { ok: false, reason: "blocked" };
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lastLoginAt: new Date() } });
  return { ok: true, user: toSessionUser(user) };
}

export function issueSession(res: Response, user: SessionUser) {
  const token = jwt.sign({ sub: user.username }, config.sessionSecret, { expiresIn: "7d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicWebUrl.startsWith("https://"),
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

/** Resolves the session cookie to an account that still exists and isn't blocked. */
export async function readSession(req: Request): Promise<SessionUser | null> {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  let username: string;
  try {
    username = (jwt.verify(token, config.sessionSecret) as { sub: string }).sub;
  } catch {
    return null;
  }
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || (user.role !== "admin" && user.blockedAt)) return null;
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
