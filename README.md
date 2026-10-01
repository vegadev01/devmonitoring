# Veganext DevMonitor

Monitors every Veganext application (HTTP health checks) and server (resource agent) from one console at **https://devmonitor.veganext.com**.

| Part | Stack | Notes |
|------|-------|-------|
| `web/` | Next.js 16, React 19 | Console UI. Proxies `/api/*` to the API, so everything is same-origin. |
| `api/` | Express, Prisma, Postgres | Auth, checks worker, incidents, email alerts, serves the agent files. |
| `agent/` | Node, no deps | Reports CPU/RAM/GPU/disk/network every 60s. |
| `Caddyfile` | Caddy | Automatic HTTPS for the domain. |

## Deploy

1. Point the DNS **A record** for `devmonitor.veganext.com` at the server (ports 80/443 open).
2. `cp .env.example .env` and set:
   - `POSTGRES_PASSWORD` (and the same password inside `DATABASE_URL`)
   - `ADMIN_PASSWORD_HASH` — `node api/scripts/hash-password.js "your-password"` (paste the *escaped* line)
   - `SESSION_SECRET` — `openssl rand -hex 32`
   - SMTP settings + `ALERT_TO_EMAIL` for alert emails
3. `docker compose up -d --build`
4. Sign in, then **Applications → Add application** for each Veganext app (use a `/health` URL when one exists) and **Servers → Add server** to get the one-line agent installer.

Local run without a domain: set `PUBLIC_*_URL` to `http://localhost:3000` (or `WEB_PORT`) and open `http://localhost:3000`.

## How it works

- Every `CHECK_INTERVAL_MS` each enabled app is probed. **Two consecutive failures** open an incident and send an email; the first success resolves it.
- A server whose agent is silent for `SERVER_OFFLINE_AFTER_MS` is flagged offline (incident + email).
- History older than `RETENTION_DAYS` is pruned nightly.
- Agent API keys are stored hashed and shown once (use *Rotate key* on a server to issue a new one).
