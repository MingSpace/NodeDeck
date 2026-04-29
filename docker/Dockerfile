# syntax=docker/dockerfile:1.7

# ---------- Stage 1: build frontend ----------
FROM node:20-alpine AS frontend-builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY frontend/package.json frontend/
RUN pnpm install --filter @mconvert/frontend... --frozen-lockfile=false

COPY frontend/ frontend/
RUN pnpm -F frontend build

# ---------- Stage 2: build backend ----------
FROM node:20-alpine AS backend-builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY backend/package.json backend/
RUN pnpm install --filter @mconvert/backend... --frozen-lockfile=false

COPY backend/ backend/
RUN pnpm -F backend build

# ---------- Stage 3: runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/app/data
ENV STATIC_DIR=/app/public

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY pnpm-workspace.yaml package.json ./
COPY backend/package.json backend/
RUN pnpm install --filter @mconvert/backend --prod --frozen-lockfile=false

COPY --from=backend-builder /app/backend/dist /app/backend/dist
COPY --from=frontend-builder /app/frontend/dist /app/public

VOLUME ["/app/data"]
EXPOSE 8080

CMD ["node", "backend/dist/index.js"]
