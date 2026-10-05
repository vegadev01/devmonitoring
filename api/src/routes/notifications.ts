import { Router } from "express";
import { prisma } from "../db";
import { requireAdmin } from "../auth";
import { config } from "../config";
import { isValidTz, outlookTimezonesAvailable } from "../graph";
import { EMAIL_RE, envRecipients, mailConfigured, notifyNow, providerInfo, resolveTimezone } from "../notify";

export const notificationsRouter = Router();
notificationsRouter.use(requireAdmin);

notificationsRouter.get("/", async (_req, res) => {
  const [rows, log] = await Promise.all([
    prisma.notificationRecipient.findMany({ orderBy: { email: "asc" } }),
    prisma.notificationLog.findMany({ orderBy: { createdAt: "desc" }, take: 150 }),
  ]);
  // Effective zone per recipient (Outlook lookups are cached, so this stays cheap).
  const recipients = await Promise.all(rows.map(async (r) => ({ ...r, effective: await resolveTimezone(r) })));
  const env = await Promise.all(
    envRecipients().filter((e) => !rows.some((r) => r.email === e)).map(async (email) => ({ email, effective: await resolveTimezone({ email }) }))
  );
  res.json({
    mail: { configured: mailConfigured, ...providerInfo() },
    defaultTimezone: isValidTz(config.alertTimezone) ? config.alertTimezone : "UTC",
    outlookTimezones: outlookTimezonesAvailable(),
    recipients,
    envRecipients: env,
    log,
  });
});

notificationsRouter.post("/recipients", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const name = String(req.body?.name ?? "").trim() || null;
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address" });
  const exists = await prisma.notificationRecipient.findUnique({ where: { email } });
  if (exists) return res.status(409).json({ error: `${email} is already a recipient` });
  res.status(201).json(await prisma.notificationRecipient.create({ data: { email, name } }));
});

notificationsRouter.patch("/recipients/:id", async (req, res) => {
  const data: { enabled?: boolean; name?: string | null; timezone?: string | null } = {};
  if (req.body?.enabled !== undefined) data.enabled = Boolean(req.body.enabled);
  if (req.body?.name !== undefined) data.name = String(req.body.name).trim() || null;
  if (req.body?.timezone !== undefined) {
    const tz = String(req.body.timezone ?? "").trim();
    if (tz && !isValidTz(tz)) return res.status(400).json({ error: `Unknown time zone "${tz}"` });
    data.timezone = tz || null; // empty = automatic
  }
  try {
    res.json(await prisma.notificationRecipient.update({ where: { id: req.params.id }, data }));
  } catch {
    res.status(404).json({ error: "Not found" });
  }
});

notificationsRouter.delete("/recipients/:id", async (req, res) => {
  await prisma.notificationRecipient.delete({ where: { id: req.params.id } }).catch(() => {});
  res.json({ ok: true });
});

// Sends a sample alert — to everyone, or only to `to` — and reports per-recipient delivery.
notificationsRouter.post("/test", async (req, res) => {
  const to = String(req.body?.to ?? "").trim().toLowerCase();
  if (to && !EMAIL_RE.test(to)) return res.status(400).json({ error: "Enter a valid email address" });
  const results = await notifyNow(
    {
      type: "test",
      service: { kind: "System", name: "DevMonitor" },
      occurredAt: new Date(),
      details: [
        ["Requested by", String((req as any).user ?? "admin")],
        ["Purpose", "Confirms that issue alerts reach the admin list"],
      ],
      link: config.publicWebUrl,
    },
    { retry: false, only: to ? [to] : undefined }
  );
  res.json({ configured: mailConfigured, results });
});
