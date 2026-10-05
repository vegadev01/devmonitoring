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

- Every `CHECK_INTERVAL_MS` each enabled app is probed (its health-check endpoint if set, otherwise its URL). **Two consecutive failures** open an incident; the first success resolves it.
- A server whose agent is silent for `SERVER_OFFLINE_AFTER_MS` is flagged offline (incident + email).
- History older than `RETENTION_DAYS` is pruned nightly.
- **Email alerts:** every issue (app down/recovered, server offline/back online, checker failure) is emailed to each admin under **Notifications** with the issue type, affected service, endpoint, timestamp and error details. Each recipient gets their own message, failed sends are retried (3 attempts), and every delivery is logged on the Notifications page. Timestamps are shown in each admin's own time zone (read from their Outlook settings, or set per person on the Notifications page). Use **Send test email** to verify.

## Email alerts with Microsoft 365

Exchange Online no longer accepts password-based SMTP, so DevMonitor sends through Microsoft Graph as `support@veganext.com`:

1. **Entra admin center → App registrations → New registration**: name `DevMonitor alerts`, single tenant.
2. **API permissions → Add → Microsoft Graph → Application permissions**: `Mail.Send` and `MailboxSettings.Read` → **Grant admin consent**.
3. **Certificates & secrets → New client secret** → copy the *Value* (shown once).
4. From **Overview** copy the *Directory (tenant) ID* and *Application (client) ID*.
5. In `.env` set `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` and `MAIL_FROM="DevMonitor <support@veganext.com>"`, then `./deploy.sh`.
6. Notifications → **Send test email** (type your own address first to test just yourself).

`Mail.Send` as an application permission can send as any mailbox in the tenant. To limit it, have an Exchange admin scope the app (RBAC for Applications or an application access policy) to a group containing `support@veganext.com` and the alert recipients. `MailboxSettings.Read` is optional: without it, alerts use `ALERT_TIMEZONE` or the per-person zone set in the app.
- Agent API keys are stored hashed and shown once (use *Rotate key* on a server to issue a new one).

## Continuous deployment & monitoring (GitHub Actions)

| Workflow | When | What it does |
|---|---|---|
| **CI/CD** (`ci-cd.yml`) | every push to `main`, every PR | API: compile, apply all migrations to a fresh Postgres, schema-drift check, boot + auth smoke test, `npm audit`. Web: production build, bundle-size budget. ShellCheck, compose/Caddy validation, Docker builds (non-root check), gitleaks secret scan. **On `main`, if everything passes: deploys over SSH**, verifies health, and **rolls back automatically** if the new release is unhealthy. |
| **Uptime** (`uptime.yml`) | every 15 min | Probes `/api/health` (DB + check loop) and `/login` from outside; fails (and GitHub emails you) if DevMonitor itself is down. |
| **Performance** (`performance.yml`) | after each deploy, daily 05:30 UTC | k6 load test with latency budgets (p95 health < 500 ms, login < 1 s, < 1% errors) and a Lighthouse audit of the login page. |
| **Maintenance** (`maintenance.yml`) | Mondays 04:00 UTC | Dependency audit + outdated report, Trivy scan, and on the server: disk/memory/container health, weekly DB backup (8 kept), Docker cleanup. |
| **Dependabot** | weekly | PRs for npm, Docker base image and Action updates (each runs full CI). |

Every deploy also takes a database backup first (`backups/predeploy-*.sql.gz`, 10 kept). Results of every run are in the run's **Summary** tab.

### One-time setup for auto-deploy

On the server (as `vndev`):

```bash
sudo usermod -aG docker vndev               # deploys run without a sudo password; log out and back in
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "github-actions-deploy"
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
cat ~/.ssh/github_deploy                     # copy → secret SSH_PRIVATE_KEY, then: rm ~/.ssh/github_deploy
ssh-keyscan 172.236.240.167                  # copy → secret SSH_KNOWN_HOSTS
```

In GitHub → **Settings → Secrets and variables → Actions**:

- Secrets: `SSH_HOST` = `172.236.240.167`, `SSH_USER` = `vndev`, `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`
- Variables (optional): `PROD_URL` (default `http://172.236.240.167`; set to `https://devmonitor.veganext.com` once DNS is live), `SSH_PORT` (default 22), `DEPLOY_PATH` (default `/opt/devmonitor`)

Until the secrets exist, CI still runs and the deploy step is skipped with a warning. To require approval before each production deploy, add reviewers under **Settings → Environments → production**.

To restore a backup (replaces all current data):

```bash
cd /opt/devmonitor && docker compose stop api
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'
gunzip -c backups/<file>.sql.gz | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose start api
```
