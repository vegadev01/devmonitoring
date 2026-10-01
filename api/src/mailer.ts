import nodemailer from "nodemailer";
import { config } from "./config";

const enabled = Boolean(config.smtp.host && config.smtp.to);
const transport = enabled
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

export async function sendAlert(subject: string, text: string) {
  if (!transport) return;
  try {
    await transport.sendMail({ from: config.smtp.from, to: config.smtp.to, subject, text });
  } catch (err) {
    console.error("[mailer] failed to send alert:", (err as Error).message);
  }
}
