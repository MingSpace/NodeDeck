# 部署指南

## 方案对比

| 方案 | 服务器开销 | 适用场景 |
|---|---|---|
| **A. GHCR 预构建镜像**(推荐) | 极小,只 pull 镜像 | 服务器配置弱(<= 1G 内存)、不想装构建工具链 |
| B. 服务器自己 build | 高(2G+ 内存友好) | 需要私有改动、断网环境 |
| C. 本地 build + 离线传输 | 极小 | 内网 / 无 registry |

下面以 **方案 A** 为主线;B/C 见末尾附录。

---

## 方案 A:GitHub Actions 自动 build + 服务器 pull(推荐)

仓库 `.github/workflows/docker.yml` 已经配好了:每次 push 到 `main` 或打 `v*` tag,GitHub Actions 会构建 `linux/amd64` 镜像并推到 GHCR `ghcr.io/mingspace/nodedeck`。服务器只需要 docker + 三个文件。

### 1. 服务器准备(只做一次)

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# 建部署目录
sudo mkdir -p /opt/nodedeck && sudo chown $USER:$USER /opt/nodedeck
cd /opt/nodedeck
```

### 2. 拉部署资产(只做一次)

服务器上只需要 3 个文件:`docker-compose.prod.yml`、`.env`、`update.sh`。直接 curl:

```bash
BASE=https://raw.githubusercontent.com/MingSpace/NodeDeck/main
curl -fsSL "$BASE/docker/docker-compose.prod.yml" -o docker-compose.prod.yml
curl -fsSL "$BASE/docker/.env.prod.example"       -o .env
curl -fsSL "$BASE/scripts/update.sh"              -o update.sh
chmod +x update.sh
```

> 这 3 个文件以后偶尔有更新(比如改了 healthcheck、加了新环境变量),重新 curl 一遍覆盖即可,不会影响 `data/` 目录里的真实配置。

### 3. 改 `.env`(必填三项)

```bash
vim .env
# 必改:
#   INITIAL_PASSWORD=<你的强密码>
#   SESSION_SECRET=$(openssl rand -base64 48)
#   PUBLIC_BASE_URL=https://sub.your-domain.com
```

> `PUBLIC_BASE_URL` 一定要写反代后的公网 URL,否则 Surge 的 `#!MANAGED-CONFIG` 头会指向 localhost,客户端无法自动更新订阅。

### 4. 启动

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f
```

打开 `http://your-vps:8080`(或反代域名)用 `admin` + `INITIAL_PASSWORD` 登录,系统会强制改密。

### 5. 升级到最新版本

```bash
cd /opt/nodedeck
./update.sh                  # 拉 latest 重启
./update.sh v0.2.0           # 锁定到具体 tag
./update.sh sha-abc1234      # 锁定到某次 commit
```

脚本会 `docker compose pull` + `up -d`,数据卷 `./data` 不会动。

### 6. 看可用的镜像 tag

GHCR 的 package 页:`https://github.com/MingSpace/NodeDeck/pkgs/container/nodedeck`

常用 tag:
- `latest` — main 分支最新
- `v0.1.0` / `0.1` — 语义化版本(打 git tag `v*` 时产出)
- `sha-abc1234` — 某次 commit
- `main` — main 分支别名

### 7. 手动触发 build(不想等 push)

GitHub 仓库 → Actions → "Build and Push Docker Image" → Run workflow,可以选分支 + 自定义额外 tag。

---

## 反向代理 + HTTPS

## 反向代理 + HTTPS(必做)

NodeDeck 本身不处理 TLS;请在前置使用 nginx / Caddy 终止 HTTPS。**不要直接把 8080 暴露公网**。

### nginx 示例

```nginx
# /etc/nginx/conf.d/nodedeck.conf
server {
    listen 443 ssl http2;
    server_name sub.your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/sub.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sub.your-domain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # 客户端订阅请求 (clash/surge 客户端会用)
    location /sub {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }

    # Web UI + API
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

server {
    listen 80;
    server_name sub.your-domain.com;
    return 301 https://$host$request_uri;
}
```

> 配置好后,把 `.env` 中的 `PUBLIC_BASE_URL` 改为 `https://sub.your-domain.com`,这样生成的 `#!MANAGED-CONFIG` URL 会用 HTTPS。

### Caddy 示例 (更简单)

```
sub.your-domain.com {
    reverse_proxy 127.0.0.1:8080
}
```

Caddy 会自动申请 Let's Encrypt 证书。

---

## 在 Clash / Surge 客户端导入

1. 在 NodeDeck Web UI 创建 Profile,得到订阅 URL
2. 把 URL 填入客户端订阅:
   - **Surge**: 设置 → 通用 → 配置 → 「Sync」→ 「Managed Config」→ 粘贴 surge URL
   - **Clash Verge / Mihomo Party**: 配置 → 新建 → URL 模式 → 粘贴 clash URL

---

## 配置文件备份

`data/` 目录是所有配置的真相,建议定期 git 提交或备份:

```bash
cd data
# 注意 .env 和 config.yaml 中的 password_hash 是敏感信息
git init
git add . ':!cache' ':!config.yaml'
git commit -m "config snapshot"
```

> `data/cache/` 是订阅源缓存,不需要备份。

---

## 升级

**方案 A(GHCR)**:
```bash
cd /opt/nodedeck && ./update.sh
```

**方案 B(服务器自己 build)**:
```bash
git pull
docker build -f docker/Dockerfile -t nodedeck:latest .
docker compose -f docker/docker-compose.yml down
docker compose -f docker/docker-compose.yml up -d
```

数据存在 `data/` 卷里,升级不会丢失。

---

## 故障排查

| 现象 | 排查 |
|---|---|
| `./update.sh` 报 `denied: requested access to the resource is denied` | GHCR package 没设成 public,去 `https://github.com/users/<owner>/packages/container/nodedeck` 设 visibility = Public;或在服务器 `docker login ghcr.io -u <user> -p <PAT>` |
| `no matching manifest for linux/amd64` | workflow 没开 amd64,或本地 build 时是 arm64;改 `.github/workflows/docker.yml` 的 `platforms` |
| 容器启动后无法访问 | 看 `docker logs nodedeck`,确认监听端口与 docker-compose ports 映射一致 |
| 首次登录密码不对 | 删除 `data/config.yaml`,重启容器,会用新的 `INITIAL_PASSWORD` 重建 |
| 改了 Web UI 配置后客户端订阅没更新 | 确认你修改的是正确的 Profile;客户端可能有自己的缓存 |
| 节点源 fetch 失败 | Web UI 仪表板会显示错误信息;常见原因: VPS 出口 IP 被机场封禁、订阅链接失效 |
| Surge import 失败 | 上传 .conf 时确认编码是 UTF-8 |

---

## 安全建议

- 一定要改 `INITIAL_PASSWORD` 和 `SESSION_SECRET`
- 给 Web UI 启用 IP 白名单(在 `data/config.yaml` 中加 `ip_allowlist`)
- 用 HTTPS 反代,**不要直接暴露 8080 到公网**
- 定期备份 `data/` (但要排除 `config.yaml` 的密码哈希到公开仓库)

---

## 附录:其他部署方案

### 方案 B:服务器自己 build

适合需要私有修改、或 GitHub Actions 不可用的环境。

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# 拉代码 + 构建 + 启动
git clone https://github.com/MingSpace/NodeDeck.git nodedeck && cd nodedeck
cp .env.example .env && vim .env   # 改密钥
docker build -f docker/Dockerfile -t nodedeck:latest .
docker compose -f docker/docker-compose.yml up -d
```

> 1G 内存的 VPS 在构建前端时可能 OOM,建议先开 1G+ swap:
> `sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`

### 方案 C:本地 build,离线传到服务器

适合内网 / 无 registry 场景。

本地(M 系列 Mac 务必显式指定 `--platform`,否则 build 出 arm64 服务器加载不了):
```bash
docker build --platform linux/amd64 -f docker/Dockerfile -t nodedeck:latest .
docker save nodedeck:latest | gzip > nodedeck.tar.gz
scp nodedeck.tar.gz docker/docker-compose.yml .env user@server:/opt/nodedeck/
```

服务器:
```bash
cd /opt/nodedeck
gunzip -c nodedeck.tar.gz | docker load
docker compose -f docker-compose.yml up -d
```
