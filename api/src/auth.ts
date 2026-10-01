import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { config } from "./config";

export const COOKIE = "dm_session";
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export function verifyLogin(user: string, password: string): boolean {
  if (!config.adminPasswordHash) return false;
  const userOk = user === config.adminUser;
  const passOk = bcrypt.compareSync(password, config.adminPasswordHash);
  return userOk && passOk;
}

export function issueSession(res: Response, user: string) {
  const token = jwt.sign({ sub: user }, config.sessionSecret, { expiresIn: "7d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicWebUrl.startsWith("https://"),
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

export function readSession(req: Request): string | null {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const p = jwt.verify(token, config.sessionSecret) as { sub: string };
    return p.sub;
  } catch {
    return null;
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = readSession(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  (req as any).user = user;
  next();
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const newApiKey = () => "dm_" + crypto.randomBytes(24).toString("hex");

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
