#!/usr/bin/env node
// Lightweight resource-monitoring agent.
// Reports CPU / RAM / GPU (if nvidia-smi present) / disk / network usage to the
// monitoring API every REPORT_INTERVAL_MS. No dependencies beyond Node's stdlib.
//
// Configure via environment variables (see install.sh):
//   API_URL     e.g. https://devmonitor.veganext.com/api
//   SERVER_ID   the server's id, shown when it was created in the dashboard
//   API_KEY     the server's API key, shown once at creation time

const os = require("node:os");
const fs = require("node:fs");
const https = require("node:https");
const http = require("node:http");
const { execSync } = require("node:child_process");

const API_URL = process.env.API_URL;
const SERVER_ID = process.env.SERVER_ID;
const API_KEY = process.env.API_KEY;
const REPORT_INTERVAL_MS = Number(process.env.REPORT_INTERVAL_MS || 60_000);

if (!API_URL || !SERVER_ID || !API_KEY) {
  console.error("API_URL, SERVER_ID, and API_KEY environment variables are required.");
  process.exit(1);
}

let prevCpu = os.cpus();
let prevNet = readNetTotals();
let prevNetAt = Date.now();

function cpuPercent() {
  const cur = os.cpus();
  let idleDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < cur.length; i++) {
    const prevTimes = prevCpu[i].times;
    const curTimes = cur[i].times;
    const prevTotal = Object.values(prevTimes).reduce((a, b) => a + b, 0);
    const curTotal = Object.values(curTimes).reduce((a, b) => a + b, 0);
    idleDelta += curTimes.idle - prevTimes.idle;
    totalDelta += curTotal - prevTotal;
  }
  prevCpu = cur;
  if (totalDelta <= 0) return null;
  return Math.max(0, Math.min(100, 100 - (idleDelta / totalDelta) * 100));
}

function ramPercent() {
  const total = os.totalmem();
  const free = os.freemem();
  return ((total - free) / total) * 100;
}

function gpuPercent() {
  try {
    const out = execSync("nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits", {
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim()
      .split("\n")[0];
    const value = Number(out);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null; // no NVIDIA GPU / nvidia-smi not installed
  }
}

function diskPercent() {
  try {
    const out = execSync("df -P /", { timeout: 3000 }).toString().trim().split("\n");
    const cols = out[1].split(/\s+/);
    // df -P: Filesystem 1024-blocks Used Available Capacity Mounted-on
    const pct = Number(cols[4].replace("%", ""));
    return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : null;
  } catch {
    return null; // e.g. Windows, or df unavailable
  }
}

function readNetTotals() {
  try {
    const text = fs.readFileSync("/proc/net/dev", "utf8");
    let rx = 0;
    let tx = 0;
    for (const line of text.split("\n").slice(2)) {
      const [iface, rest] = line.split(":");
      if (!rest || !iface || iface.trim() === "lo") continue;
      const fields = rest.trim().split(/\s+/);
      rx += Number(fields[0] || 0);
      tx += Number(fields[8] || 0);
    }
    return { rx, tx };
  } catch {
    return null; // not Linux / no /proc
  }
}

function netRates() {
  const now = Date.now();
  const cur = readNetTotals();
  const elapsedSec = (now - prevNetAt) / 1000;
  let rxRate = null;
  let txRate = null;
  if (cur && prevNet && elapsedSec > 0) {
    rxRate = Math.max(0, (cur.rx - prevNet.rx) / elapsedSec);
    txRate = Math.max(0, (cur.tx - prevNet.tx) / elapsedSec);
  }
  prevNet = cur;
  prevNetAt = now;
  return { rxRate, txRate };
}

function post(body) {
  // Append (not resolve) so a path prefix like https://host/api is preserved.
  const url = new URL(`${API_URL.replace(/\/+$/, "")}/servers/${SERVER_ID}/metrics`);
  const payload = JSON.stringify(body);
  const client = url.protocol === "https:" ? https : http;

  const req = client.request(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "X-API-Key": API_KEY,
      },
    },
    (res) => {
      if (res.statusCode && res.statusCode >= 300) {
        console.error(`[agent] server responded ${res.statusCode}`);
      }
      res.resume();
    }
  );
  req.on("error", (err) => console.error("[agent] failed to report metrics:", err.message));
  req.write(payload);
  req.end();
}

function reportOnce() {
  const { rxRate, txRate } = netRates();
  post({
    cpuPct: cpuPercent(),
    ramPct: ramPercent(),
    gpuPct: gpuPercent(),
    diskPct: diskPercent(),
    netRxBytes: rxRate,
    netTxBytes: txRate,
  });
}

console.log(`[agent] reporting to ${API_URL} every ${REPORT_INTERVAL_MS}ms`);
// First CPU reading needs a baseline; wait one tick before the first real report.
setTimeout(() => {
  reportOnce();
  setInterval(reportOnce, REPORT_INTERVAL_MS);
}, 1000);
