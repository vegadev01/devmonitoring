import { Router } from "express";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../auth";

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole("admin"));

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { username: "asc" }],
    select: { id: true, username: true, role: true, failedAttempts: true, blockedAt: true, lastLoginAt: true, createdAt: true },
  });
  res.json(users);
});

usersRouter.post("/:id/unblock", async (req, res) => {
  const { count } = await prisma.user.updateMany({ where: { id: req.params.id }, data: { blockedAt: null, failedAttempts: 0 } });
  if (!count) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true });
});
