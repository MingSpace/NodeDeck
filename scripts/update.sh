#!/usr/bin/env bash
# NodeDeck 服务器端更新脚本
#
# 用法(在服务器部署目录里,跟 docker-compose.yml 同级):
#   ./update.sh              # docker compose pull + up,沿用当前 image tag
#   ./update.sh latest       # 切到 latest,然后 pull + up
#   ./update.sh v0.2.0       # 切到指定版本 tag
#   ./update.sh sha-abc1234  # 切到指定 commit
#
# 这个脚本会:
#   1. 如果传了 tag,把 docker-compose.yml 里 image 行的 :TAG 改成新值
#   2. docker compose pull 拉新镜像
#   3. docker compose up -d 滚动重启(./data 数据卷不会丢)
#   4. docker image prune -f 清理旧镜像层

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
NEW_TAG="${1:-}"

cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "ERROR: ${COMPOSE_FILE} not found in $(pwd)" >&2
  echo "Hint: 把 docker-compose.yml 跟这个脚本放在同一个目录" >&2
  exit 1
fi

if [[ -n "${NEW_TAG}" ]]; then
  echo "==> Switching image tag to :${NEW_TAG} in ${COMPOSE_FILE}"
  # 替换 ghcr.io/mingspace/nodedeck:<anything> 为新 tag
  sed -i.bak -E "s|(image:[[:space:]]+ghcr\.io/mingspace/nodedeck):[^[:space:]]+|\1:${NEW_TAG}|" "${COMPOSE_FILE}"
  rm -f "${COMPOSE_FILE}.bak"
fi

CURRENT_IMAGE=$(grep -E '^[[:space:]]*image:' "${COMPOSE_FILE}" | head -n1 | awk '{print $2}')
echo "==> Target image: ${CURRENT_IMAGE}"

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
