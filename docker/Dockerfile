# syntax=docker/dockerfile:1.7

# ---------- Stage 1: build frontend ----------
FROM node:20-alpine AS frontend-builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY frontend/package.json frontend/
RUN pnpm install --filter @nodedeck/frontend... --frozen-lockfile=false

COPY frontend/ frontend/
RUN pnpm -F frontend build

# ---------- Stage 2: build backend + 产出干净 node_modules ----------
FROM node:20-alpine AS backend-builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY backend/package.json backend/
RUN pnpm install --filter @nodedeck/backend... --frozen-lockfile=false

COPY backend/ backend/
RUN pnpm -F backend build
# 用 pnpm deploy 把 prod 依赖 + 编译产物打包到独立目录,
# runtime stage 直接 COPY 即可,无需再装一遍 corepack/pnpm。
# --legacy: pnpm v10 改了默认行为,非 inject-workspace-packages 模式必须显式 opt-in 旧版 deploy
RUN pnpm --filter @nodedeck/backend deploy --legacy --prod /out

# ---------- Stage 3: runtime(裸 node) ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/app/data
ENV STATIC_DIR=/app/public

COPY --from=backend-builder /out /app
COPY --from=frontend-builder /app/frontend/dist /app/public

VOLUME ["/app/data"]
EXPOSE 8080

CMD ["node", "dist/index.js"]
