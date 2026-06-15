# NodeDeck

> Clash + Surge 订阅转换器,带 Web 配置中心。

服务 **Clash Meta (Mihomo) + Surge 5**。后端 Node.js + Hono,前端 React + 现代 UI,单 Docker 镜像部署,文件系统持久化(改完即生效)。

---

## 特性

- **多 Profile**: 一份配置中心,生成多套订阅 URL,每个 Profile 独立 token
- **节点源混合**: 在线订阅链接 + 本地节点文件 + 手输节点,统一去重 + 自动同名加 ` #2` 后缀避免冲突
- **规则模块化**: 拼装规则模块,支持 RULE-SET URL / inline payload / GEOSITE / GEOIP / DOMAIN-SET / Surge inline ruleset
- **链式代理**: 任意节点可配置前置代理(Clash `dialer-proxy` / Surge `underlying-proxy`),应用前自动做环检测 + 悬空引用降级
- **Surge 高级特性**: Module / MITM / URL Rewrite / Header Rewrite / Script / inline ruleset / REJECT-DROP 子类型 + 通知参数 / `Profile-Update-Interval` / 节点名非法字符自动净化
- **Clash 高级特性**: proxy-providers (按机场切片,独立健康检查) / rule-providers / DNS / TUN / sniffer / 全协议(VLESS+Reality / Hysteria2 / TUIC v5 / WireGuard 等) / Surge 专属 REJECT 子类型自动降级
- **多机场流量聚合**: 标准 `Subscription-UserInfo` 聚合 (sum / primary 两种模式) + Web 仪表板每机场详情 + 自定义 `X-NodeDeck-Userinfo-<id>` header
- **URL token 鉴权**: 12 字符 nanoid,Profile 级独立,可一键重生
- **改完不重启**: 文件即真相,chokidar 自动失效缓存,所有配置变化即时生效

---

## 快速开始

### Docker(推荐生产部署)

服务器只需要 docker + 一个 compose 文件,镜像直接从 GHCR 拉:

```bash
mkdir -p /opt/nodedeck && cd /opt/nodedeck
curl -fsSL https://raw.githubusercontent.com/MingSpace/NodeDeck/main/docker/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/MingSpace/NodeDeck/main/scripts/update.sh -o update.sh && chmod +x update.sh

vim docker-compose.yml      # 改两个 [必改] 项:INITIAL_PASSWORD / PUBLIC_BASE_URL
docker compose up -d
```

> Session 密钥首次启动会自动生成在 `data/secret.key`,不需要手填;后续启动直接复用,不会让登录态失效。

打开 `http://your-vps:8080`,首次登录用 `admin` + 你设置的 `INITIAL_PASSWORD`,系统会强制改密。

升级:`./update.sh` (沿用当前 tag) 或 `./update.sh v0.2.0` (锁版本)。完整部署文档见 [docs/deployment.md](docs/deployment.md)。

### 本地开发

```bash
pnpm install
pnpm dev          # 后端 8080 + 前端 5173 (反代 /api 与 /sub 到后端)
```

### 订阅 URL

每个 Profile 在 Web UI 中创建后会自动生成订阅 URL:

```
# Clash (Mihomo)
http://your-vps:8080/sub?profile=home&target=clash&t=V1StGXR8_Z5j

# Surge 5
http://your-vps:8080/sub?profile=home&target=surge&t=V1StGXR8_Z5j
```

启用 `clash_options.use_proxy_providers` + 单个 provider 的 `clash_proxy_provider.enabled` 后,主订阅会引用每机场独立的拉取目标:

```
# Mihomo proxy-provider 自动拉取(由主订阅 yaml 中的 proxy-providers 段引用,不需要手动添加)
http://your-vps:8080/sub/provider/airport-a/clash.yaml?profile=home&t=V1StGXR8_Z5j
```

Profile 列表页有「复制 URL」按钮,直接粘贴到客户端的"订阅"中即可。

更多用法见 [docs/cookbook.md](docs/cookbook.md)。

---

## 文档

- [设计概览](docs/design.md)
- [协议字段对照表 (Clash ↔ Surge)](docs/protocol-mapping.md)
- [使用手册 (规则/链式/proxy-providers 示例)](docs/cookbook.md)
- [链式代理用法](docs/chain-proxy.md)
- [部署指南 (含 nginx / Caddy 反代)](docs/deployment.md)
- [给 AI 的指南 (AGENTS.md)](AGENTS.md)

---

## 架构

```
backend/   Node.js 20 + Hono + TypeScript
frontend/  React 18 + Vite + Tailwind + shadcn-style + TanStack Query + Monaco
docker/    multi-stage Dockerfile + docker-compose.yml(GHCR 镜像 + 内联配置)
data/      运行时持久化(YAML + JSON,挂载到容器,gitignored)
docs/      设计 / 字段映射 / 链式代理 / 部署文档
```

---

## 范围说明

**本项目专注做好**:

- Clash Meta (Mihomo) 与 Surge 5 的高质量订阅生成
- Web 可视化配置(节点源 / 规则 / 策略组 / Surge 模块 / General 预设 / Profile)
- 多机场流量信息透传与可视化
- 链式代理统一抽象

**显式排除**:

- 公共服务 / 多用户 / SSO / 计费
- Quantumult X / Loon / V2RayN 等其他客户端的输出
- 内置 TLS 终止(交给前置 nginx/Caddy)

---

## 开发命令

```bash
pnpm install              # 安装依赖
pnpm dev                  # 同时起后端 + 前端
pnpm typecheck            # 全 workspace 类型检查
pnpm test                 # backend vitest run
pnpm build                # 构建生产产物
```

> Docker 镜像由 GitHub Actions 在 push 时自动构建并推送到 GHCR,服务器只需 pull(详见 [docs/deployment.md](docs/deployment.md))。本地不再提供 `docker:*` 脚本。

---

## License

MIT
