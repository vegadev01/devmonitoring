import express, { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { requireAdmin } from "../auth";
import { describeError, send } from "../httpclient";

// API Studio: Veganext's built-in endpoint tester. Requests run server-side so they work against
// internal hosts, self-signed certs and APIs without CORS. Admin-only.
export const studioRouter = Router();
studioRouter.use(express.json({ limit: "5mb" }));
studioRouter.use(requireAdmin);

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const MAX_BODY = 2 * 1024 * 1024;
const TEXTY = /json|xml|text|javascript|html|csv|yaml|x-www-form-urlencoded|graphql/i;

studioRouter.post("/send", async (req, res) => {
  const b = req.body ?? {};
  const method = METHODS.includes(String(b.method).toUpperCase()) ? String(b.method).toUpperCase() : "GET";
  const headers: Record<string, string> = {};
  for (const h of Array.isArray(b.headers) ? b.headers : []) {
    if (h && h.enabled !== false && typeof h.key === "string" && h.key.trim()) headers[h.key.trim()] = String(h.value ?? "");
  }
  try {
    const r = await send({
      method,
      url: String(b.url ?? ""),
      headers,
      body: typeof b.body === "string" ? b.body : null,
      insecureTls: Boolean(b.insecureTls),
      timeoutMs: Math.min(120_000, Math.max(1000, Number(b.timeoutMs) || 30_000)),
      followRedirects: b.followRedirects !== false,
      maxBody: MAX_BODY,
    });
    const ctype = String(r.headers["content-type"] ?? "");
    const isText = !ctype || TEXTY.test(ctype);
    res.json({
      ok: true,
      status: r.status,
      statusText: r.statusText,
      headers: r.headers,
      timeMs: r.timeMs,
      size: r.size,
      truncated: r.truncated,
      finalUrl: r.finalUrl,
      redirects: r.redirects,
      contentType: ctype,
      body: isText ? r.body.toString("utf8") : null,
      binary: !isText,
    });
  } catch (e) {
    res.json({ ok: false, error: describeError(e) });
  }
});

// ---- Saved requests -------------------------------------------------------
function parseSaved(b: any, partial = false) {
  const d: Record<string, unknown> = {};
  if (!partial || b.name !== undefined) {
    if (typeof b.name !== "string" || !b.name.trim()) throw new Error("Name is required");
    d.name = b.name.trim().slice(0, 200);
  }
  if (!partial || b.url !== undefined) {
    if (typeof b.url !== "string" || !b.url.trim()) throw new Error("URL is required");
    d.url = b.url.trim();
  }
  if (b.collection !== undefined) d.collection = String(b.collection || "General").trim().slice(0, 100) || "General";
  if (b.method !== undefined) d.method = METHODS.includes(String(b.method).toUpperCase()) ? String(b.method).toUpperCase() : "GET";
  if (b.params !== undefined) d.params = Array.isArray(b.params) ? b.params : [];
  if (b.headers !== undefined) d.headers = Array.isArray(b.headers) ? b.headers : [];
  if (b.bodyType !== undefined) d.bodyType = ["none", "json", "text", "form"].includes(b.bodyType) ? b.bodyType : "none";
  if (b.body !== undefined) d.body = b.body == null ? null : String(b.body);
  if (b.auth !== undefined) d.auth = b.auth && typeof b.auth === "object" ? b.auth : {};
  if (b.insecureTls !== undefined) d.insecureTls = Boolean(b.insecureTls);
  return d;
}

studioRouter.get("/requests", async (_req, res) => {
  res.json(await prisma.savedRequest.findMany({ orderBy: [{ collection: "asc" }, { name: "asc" }] }));
});

studioRouter.post("/requests", async (req, res) => {
  try {
    res.status(201).json(await prisma.savedRequest.create({ data: parseSaved(req.body) as Prisma.SavedRequestCreateInput }));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

studioRouter.patch("/requests/:id", async (req, res) => {
  try {
    res.json(await prisma.savedRequest.update({ where: { id: req.params.id }, data: parseSaved(req.body, true) }));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

studioRouter.delete("/requests/:id", async (req, res) => {
  await prisma.savedRequest.delete({ where: { id: req.params.id } }).catch(() => {});
  res.json({ ok: true });
});

studioRouter.delete("/collections/:name", async (req, res) => {
  const r = await prisma.savedRequest.deleteMany({ where: { collection: req.params.name } });
  res.json({ deleted: r.count });
});

// ---- OpenAPI / Swagger import -----------------------------------------------
type Endpoint = { method: string; path: string; summary: string; tag: string; body: string | null };

function exampleFor(schema: any, spec: any, depth = 0): unknown {
  if (!schema || depth > 5) return null;
  if (schema.$ref) {
    const ref = String(schema.$ref).replace(/^#\//, "").split("/").reduce((o: any, k: string) => o?.[k], spec);
    return exampleFor(ref, spec, depth + 1);
  }
  if (schema.example !== undefined) return schema.example;
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s: any) => exampleFor(s, spec, depth + 1)));
  if (schema.oneOf || schema.anyOf) return exampleFor((schema.oneOf || schema.anyOf)[0], spec, depth + 1);
  switch (schema.type) {
    case "object":
    case undefined:
      if (!schema.properties) return schema.type === "object" ? {} : null;
      return Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, exampleFor(v, spec, depth + 1)]));
    case "array":
      return [exampleFor(schema.items, spec, depth + 1)];
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    default:
      return schema.enum?.[0] ?? (schema.format === "date-time" ? new Date(0).toISOString() : "string");
  }
}

function parseSpec(spec: any, specUrl: string) {
  if (!spec || typeof spec !== "object" || !spec.paths) throw new Error("Not an OpenAPI/Swagger document (no \"paths\")");
  let base = "";
  if (spec.servers?.[0]?.url) base = new URL(spec.servers[0].url, specUrl).toString();
  else if (spec.host) base = `${spec.schemes?.[0] ?? "https"}://${spec.host}${spec.basePath ?? ""}`;
  else base = new URL("/", specUrl).toString();
  base = base.replace(/\/$/, "");

  const endpoints: Endpoint[] = [];
  for (const [path, ops] of Object.entries<any>(spec.paths)) {
    for (const [m, op] of Object.entries<any>(ops ?? {})) {
      const method = m.toUpperCase();
      if (!METHODS.includes(method)) continue;
      const schema = op?.requestBody?.content?.["application/json"]?.schema ?? op?.parameters?.find((p: any) => p.in === "body")?.schema;
      const example = schema ? exampleFor(schema, spec) : null;
      endpoints.push({
        method,
        path,
        summary: op?.summary || op?.operationId || "",
        tag: op?.tags?.[0] || "",
        body: example != null ? JSON.stringify(example, null, 2) : null,
      });
    }
  }
  return { title: String(spec.info?.title || "Imported API"), version: String(spec.info?.version || ""), base, endpoints };
}

studioRouter.post("/import", async (req, res) => {
  try {
    let spec: any = req.body?.spec;
    const specUrl = String(req.body?.url || "http://localhost/");
    if (!spec) {
      if (!req.body?.url) throw new Error("Provide a spec URL or paste the JSON");
      const r = await send({ method: "GET", url: specUrl, insecureTls: Boolean(req.body.insecureTls), timeoutMs: 20_000, maxBody: 10 * 1024 * 1024, headers: { Accept: "application/json" } });
      if (r.status >= 400) throw new Error(`Spec URL returned HTTP ${r.status}`);
      try {
        spec = JSON.parse(r.body.toString("utf8"));
      } catch {
        throw new Error("Spec is not JSON (YAML specs are not supported yet — use the JSON version, often /openapi.json or /swagger.json)");
      }
    } else if (typeof spec === "string") {
      try {
        spec = JSON.parse(spec);
      } catch {
        throw new Error("Pasted spec is not valid JSON");
      }
    }
    const parsed = parseSpec(spec, specUrl);
    if (!parsed.endpoints.length) throw new Error("No endpoints found in the spec");
    const collection = (String(req.body?.collection || "").trim() || `${parsed.title}${parsed.version ? ` v${parsed.version}` : ""}`).slice(0, 100);
    const rows = parsed.endpoints.slice(0, 500).map((e) => ({
      name: `${e.summary || `${e.method} ${e.path}`}`.slice(0, 200),
      collection,
      method: e.method,
      url: `{{baseUrl}}${e.path.replace(/\{([^}]+)\}/g, "{{$1}}")}`,
      headers: e.body ? [{ key: "Content-Type", value: "application/json", enabled: true }] : [],
      bodyType: e.body ? "json" : "none",
      body: e.body,
      insecureTls: Boolean(req.body?.insecureTls),
    }));
    await prisma.savedRequest.createMany({ data: rows });
    res.json({ collection, baseUrl: parsed.base, imported: rows.length });
  } catch (e) {
    res.status(400).json({ error: describeError(e) });
  }
});
