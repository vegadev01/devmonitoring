// k6 smoke/load test for production. Light on purpose: verifies latency budgets, not capacity.
// Run: k6 run -e BASE_URL=http://172.236.240.167 .github/perf/smoke.js
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

export const options = {
  scenarios: {
    smoke: { executor: "ramping-vus", startVUs: 1, stages: [{ duration: "20s", target: 10 }, { duration: "40s", target: 10 }, { duration: "10s", target: 0 }] },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"], // <1% errors
    "http_req_duration{endpoint:health}": ["p(95)<500"],
    "http_req_duration{endpoint:login}": ["p(95)<1000"],
    checks: ["rate>0.99"],
  },
};

export default function () {
  const h = http.get(`${BASE}/api/health`, { tags: { endpoint: "health" } });
  check(h, { "health 200": (r) => r.status === 200, "health ok": (r) => r.json("ok") === true });
  const l = http.get(`${BASE}/login`, { tags: { endpoint: "login" } });
  check(l, { "login 200": (r) => r.status === 200 });
  sleep(1);
}

// Markdown summary for the GitHub job page.
export function handleSummary(data) {
  const m = data.metrics;
  const ms = (v) => (v == null ? "—" : `${v.toFixed(0)} ms`);
  const row = (name, key) => {
    const v = m[key]?.values;
    return `| ${name} | ${ms(v?.avg)} | ${ms(v?.med)} | ${ms(v?.["p(95)"])} | ${ms(v?.max)} |`;
  };
  const failed = Object.entries(data.metrics).filter(([, v]) => v.thresholds && Object.values(v.thresholds).some((t) => !t.ok)).map(([k]) => k);
  const md = [
    `### k6 load test — ${failed.length ? "❌ thresholds failed: " + failed.join(", ") : "✅ all thresholds passed"}`,
    "",
    `Target \`${BASE}\` · ${m.iterations?.values.count ?? 0} iterations · ${m.http_reqs?.values.count ?? 0} requests · ${(m.http_reqs?.values.rate ?? 0).toFixed(1)} req/s · errors ${((m.http_req_failed?.values.rate ?? 0) * 100).toFixed(2)}%`,
    "",
    "| Endpoint | avg | median | p95 | max |",
    "|---|---|---|---|---|",
    row("/api/health", "http_req_duration{endpoint:health}"),
    row("/login", "http_req_duration{endpoint:login}"),
    "",
  ].join("\n");
  return { "k6-summary.md": md, stdout: md + "\n" };
}
