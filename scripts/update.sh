#!/usr/bin/env bash
# NodeDeck 服务器端更新脚本
#
# 用法(在服务器上,部署目录里):
#   ./update.sh              # 拉 latest 并重启
#   ./update.sh v0.2.0       # 切到指定版本 tag
#   ./update.sh sha-abc1234  # 切到指定 commit
#
# 环境变量(可选):
#   COMPOSE_FILE=docker-compose.prod.yml  # compose 文件名
#   ENV_FILE=.env                          # 环境变量文件
#
# 这个脚本会:
#   1. 把 .env 里的 IMAGE_TAG 写成你指定的值(不传就保留现有的)
#   2. docker compose pull 拉新镜像
#   3. docker compose up -d 滚动重启(配置/数据卷不会丢)
#   4. docker image prune -f 清理旧镜像层

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env}"
NEW_TAG="${1:-}"

cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "ERROR: ${COMPOSE_FILE} not found in $(pwd)" >&2
  echo "Hint: 把 docker-compose.prod.yml 和 .env 跟这个脚本放在同一个目录" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} not found. Copy .env.prod.example to .env first." >&2
  exit 1
fi

if [[ -n "${NEW_TAG}" ]]; then
  echo "==> Setting IMAGE_TAG=${NEW_TAG} in ${ENV_FILE}"
  if grep -q '^IMAGE_TAG=' "${ENV_FILE}"; then
    # macOS/Linux 通用的 sed in-place
    sed -i.bak "s|^IMAGE_TAG=.*|IMAGE_TAG=${NEW_TAG}|" "${ENV_FILE}"
    rm -f "${ENV_FILE}.bak"
  else
    echo "IMAGE_TAG=${NEW_TAG}" >> "${ENV_FILE}"
  fi
fi

CURRENT_TAG=$(grep '^IMAGE_TAG=' "${ENV_FILE}" | cut -d= -f2 || echo "latest")
echo "==> Target tag: ${CURRENT_TAG:-latest}"

echo "==> Pulling image"
docker compose -f "${COMPOSE_FILE}" pull

echo "==> Recreating containers"
docker compose -f "${COMPOSE_FILE}" up -d

echo "==> Waiting for health"
sleep 3
docker compose -f "${COMPOSE_FILE}" ps

echo "==> Pruning dangling images"
docker image prune -f >/dev/null

echo "==> Recent logs:"
docker compose -f "${COMPOSE_FILE}" logs --tail 30 --no-color

echo ""
echo "Done. 如果反代已配,几秒内 https://your-domain 应该可用。"
