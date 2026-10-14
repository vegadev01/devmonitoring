import { Router, type NextFunction, type Response } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { USERNAME_RE, currentUser, issueSession, normalizeUsername, requireAuth, requireRole, type Role } from "../auth";

// User management is admin-only; staff never see the Users tab and get 403 here.
export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole("admin"));

const PUBLIC = { id: true, username: true, role: true, failedAttempts: true, blockedAt: true, blockedBy: true, lastLoginAt: true, createdAt: true } as const;
const ROLES: Role[] = ["admin", "staff"];

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const badRequest = (m: string) => new HttpError(400, m);

function parseUsername(v: unknown) {
  const u = normalizeUsername(String(v ?? ""));
  if (!USERNAME_RE.test(u)) throw badRequest("Username must be 3–32 characters: letters, digits, dots, dashes or underscores");
  return u;
}
function parsePassword(v: unknown) {
  const p = typeof v === "string" ? v : "";
  if (p.length < 8) throw badRequest("Password must be at least 8 characters");
  if (Buffer.byteLength(p) > 72) throw badRequest("Password must be at most 72 bytes"); // bcrypt ignores anything longer
  return p;
}
function parseRole(v: unknown): Role {
  if (!ROLES.includes(v as Role)) throw badRequest("Role must be admin or staff");
  return v as Role;
}

function fail(res: Response, next: NextFunction, e: unknown) {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return res.status(409).json({ error: "That username is already taken" });
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return res.status(404).json({ error: "User not found" });
  next(e);
}

usersRouter.get("/", async (req, res) => {
  const users = await prisma.user.findMany({ orderBy: [{ role: "asc" }, { username: "asc" }], select: PUBLIC });
  res.json({ me: currentUser(req).id, users });
});

usersRouter.post("/", async (req, res, next) => {
  try {
    const username = parseUsername(req.body?.username);
    const passwordHash = await bcrypt.hash(parsePassword(req.body?.password), 10);
    const role = parseRole(req.body?.role);
    res.status(201).json(await prisma.user.create({ data: { username, passwordHash, role }, select: PUBLIC }));
  } catch (e) {
    fail(res, next, e);
  }
});

// Edit username, role and/or password. Changing the password signs that account out everywhere.
usersRouter.patch("/:id", async (req, res, next) => {
  try {
    const me = currentUser(req);
    const self = req.params.id === me.id;
    const data: Prisma.UserUpdateInput = {};
    if (req.body?.username !== undefined) data.username = parseUsername(req.body.username);
    if (req.body?.password !== undefined && req.body.password !== "") {
      data.passwordHash = await bcrypt.hash(parsePassword(req.body.password), 10);
      data.tokenVersion = { increment: 1 };
    }
    if (req.body?.role !== undefined) {
      const role = parseRole(req.body.role);
      if (self && role !== me.role) throw badRequest("You can't change your own role");
      data.role = role;
      // Admins can never be blocked, so promoting a blocked account unblocks it.
      if (role === "admin") Object.assign(data, { blockedAt: null, blockedBy: null, failedAttempts: 0 });
    }

    const user = await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id: req.params.id } });
      if (!before) throw new HttpError(404, "User not found");
      if (before.role === "admin" && data.role === "staff" && (await tx.user.count({ where: { role: "admin" } })) <= 1) {
        throw badRequest("At least one admin account must remain");
      }
      return tx.user.update({ where: { id: before.id }, data });
    });

    // Keep the admin signed in after changing their own password.
    if (self && data.tokenVersion) issueSession(res, user);
    res.json(await prisma.user.findUnique({ where: { id: user.id }, select: PUBLIC }));
  } catch (e) {
    fail(res, next, e);
  }
});

usersRouter.post("/:id/block", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.role === "admin") return res.status(400).json({ error: "Admin accounts can't be blocked" });
  await prisma.user.update({ where: { id: user.id }, data: { blockedAt: new Date(), blockedBy: currentUser(req).username } });
  res.json({ ok: true });
});

usersRouter.post("/:id/unblock", async (req, res) => {
  const { count } = await prisma.user.updateMany({ where: { id: req.params.id }, data: { blockedAt: null, blockedBy: null, failedAttempts: 0 } });
  if (!count) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true });
});

usersRouter.delete("/:id", async (req, res, next) => {
  try {
    if (req.params.id === currentUser(req).id) throw badRequest("You can't delete your own account");
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: req.params.id } });
      if (!user) throw new HttpError(404, "User not found");
      if (user.role === "admin" && (await tx.user.count({ where: { role: "admin" } })) <= 1) throw badRequest("At least one admin account must remain");
      await tx.user.delete({ where: { id: user.id } });
    });
    res.json({ ok: true });
  } catch (e) {
    fail(res, next, e);
  }
});
