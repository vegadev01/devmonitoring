# Build context is the repo root (see docker-compose.yml)
FROM node:20-alpine AS base
WORKDIR /app
# Prisma's query engine needs OpenSSL, which isn't in the base alpine image.
RUN apk add --no-cache openssl

COPY api/package.json api/package-lock.json* ./
RUN npm install

COPY api/prisma ./prisma
RUN npx prisma generate

COPY api/ .
COPY agent/ ./public/agent/
RUN npm run build

EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
