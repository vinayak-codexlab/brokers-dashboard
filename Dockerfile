# syntax=docker/dockerfile:1

# ---- Build: compile TypeScript -> dist/ ----
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime deps only ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- Runtime ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

# Secrets (MONGO_URI, JWT_SECRET, ENCRYPTION_SECRET) are injected at runtime, never baked in.
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/health/ready" > /dev/null || exit 1

CMD ["node", "dist/server.js"]
