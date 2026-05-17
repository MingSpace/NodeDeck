# 部署指南

## 推荐: Docker Compose

### 1. 准备环境

在你的境外 VPS 上(网络良好处)安装 Docker:

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

### 2. 克隆仓库 + 构建镜像

```bash
git clone <this-repo> nodedeck && cd nodedeck
docker build -f docker/Dockerfile -t nodedeck:latest .
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env, 至少修改:
#   INITIAL_PASSWORD=<your-strong-password>
#   SESSION_SECRET=$(openssl rand -base64 48)
#   PUBLIC_BASE_URL=https://sub.your-domain.com
```

### 4. 启动

```bash
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml logs -f
```

服务监听 `:8080`,数据持久化到 `./data` 目录。

### 5. 首次登录

打开 `http://your-vps:8080`,使用 `admin` + `INITIAL_PASSWORD` 登录,系统会强制要求修改密码。

---

## 反向代理 + HTTPS (推荐)

NodeDeck 本身不处理 TLS;请在前置使用 nginx / Caddy 终止 HTTPS。

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

```bash
git pull
docker build -f docker/Dockerfile -t nodedeck:latest .
docker compose -f docker/docker-compose.yml down
docker compose -f docker/docker-compose.yml up -d
```

由于配置文件存在 `data/` 卷里,升级不会丢失数据。

---

## 故障排查

| 现象 | 排查 |
|---|---|
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
