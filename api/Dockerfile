# Build context is the repo root (see docker-compose.yml)
FROM node:20-alpine
# Prisma's query engine needs OpenSSL, which isn't in the base alpine image.
RUN apk add --no-cache openssl
WORKDIR /app
RUN chown node:node /app
# Run as the unprivileged "node" user (build and runtime).
USER node

COPY --chown=node:node api/package.json api/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY --chown=node:node api/prisma ./prisma
RUN npx prisma generate

COPY --chown=node:node api/ .
COPY --chown=node:node agent/ ./public/agent/
# Compile, then drop dev-only packages (TypeScript, type definitions) from the final image.
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health >/dev/null || exit 1

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
