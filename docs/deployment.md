# 部署指南
**从 GHCR 拉预构建镜像**。仓库 `.github/workflows/docker.yml` 已经配好,每次 push 到 `main` 或打 `v*` tag,GitHub Actions 会构建 `linux/amd64` 镜像并推到 GHCR `ghcr.io/mingspace/nodedeck`。服务器只需要 docker + 一个 `docker-compose.yml`。

---

## 1. 服务器准备(只做一次)

```bash
# 安装 Docker
....

# 建部署目录
sudo mkdir -p /opt/nodedeck && sudo chown $USER:$USER /opt/nodedeck
cd /opt/nodedeck
```

---

## 2. 拉部署资产

```bash
BASE=https://raw.githubusercontent.com/MingSpace/NodeDeck/main
curl -fsSL "$BASE/docker/docker-compose.yml" -o docker-compose.yml
```

> 这个文件以后偶尔有更新(改了端口、加了新环境变量),重新 curl 一遍覆盖即可,不会影响 `data/` 目录里的真实配置。注意:**重新 curl 会把你改过的密码 / PUBLIC_BASE_URL 重置成占位值**,覆盖前先备份。Session 密钥保存在 `data/secret.key`,不在 yml 里,不会被覆盖。

---

## 3. 改 `docker-compose.yml`(必改两项)

```bash
vim docker-compose.yml
```

把 `environment:` 里标 `[必改]` 的两个值改掉:

```yaml
INITIAL_PASSWORD: <你的强密码>
PUBLIC_BASE_URL: https://sub.your-domain.com
```

> `PUBLIC_BASE_URL` 一定要写反代后的公网 URL,否则 Surge 的 `#!MANAGED-CONFIG` 头会指向 localhost,客户端无法自动更新订阅。

> Session 加密密钥(`SESSION_SECRET`)默认不需要配,首次启动会自动生成并保存到 `data/secret.key`,后续启动直接复用,不会让登录态失效。只有想在多实例间共享会话、或用 k8s Secret 注入时才显式指定。

---

## 4. 启动

```bash
docker compose up -d
docker compose logs -f
```

打开 `http://your-vps:8080`(或反代域名)用 `admin` + `INITIAL_PASSWORD` 登录,系统会强制改密。

---

## 5. 升级到最新版本

沿用当前 image tag,拉最新镜像并重启:

```bash
cd /opt/nodedeck
docker compose pull
docker compose up -d
```

想切到别的版本,先编辑 `docker-compose.yml` 里的 image tag(如 `:latest`、`:v0.2.0`、`:sha-abc1234`)再执行上面两条。数据卷 `./data` 不会动。

---

## 6. 看可用的镜像 tag

GHCR 的 package 页:`https://github.com/MingSpace/NodeDeck/pkgs/container/nodedeck`

常用 tag:
- `latest` — main 分支最新
- `v0.1.0` / `0.1` — 语义化版本(打 git tag `v*` 时产出)
- `sha-abc1234` — 某次 commit
- `main` — main 分支别名

---

## 7. 手动触发 build(不想等 push)

GitHub 仓库 → Actions → "Build and Push Docker Image" → Run workflow,可以选分支 + 自定义额外 tag。

---

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

> 配置好后,把 `docker-compose.yml` 中的 `PUBLIC_BASE_URL` 改为 `https://sub.your-domain.com`,这样生成的 `#!MANAGED-CONFIG` URL 会用 HTTPS。

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
# 注意 config.yaml 中的 password_hash 是敏感信息
git init
git add . ':!cache' ':!config.yaml'
git commit -m "config snapshot"
```

> `data/cache/` 是订阅源缓存,不需要备份。

---

## 故障排查

| 现象 | 排查 |
|---|---|
| `docker compose pull` 报 `denied: requested access to the resource is denied` | GHCR package 没设成 public,去 `https://github.com/users/<owner>/packages/container/nodedeck` 设 visibility = Public;或在服务器 `docker login ghcr.io -u <user> -p <PAT>` |
| `no matching manifest for linux/amd64` | workflow 没开 amd64;检查 `.github/workflows/docker.yml` 的 `platforms` |
| 容器启动后无法访问 | 看 `docker logs nodedeck`,确认监听端口与 docker-compose ports 映射一致 |
| 首次登录密码不对 | 删除 `data/config.yaml`,重启容器,会用新的 `INITIAL_PASSWORD` 重建 |
| 改了 Web UI 配置后客户端订阅没更新 | 确认你修改的是正确的 Profile;客户端可能有自己的缓存 |
| 节点源 fetch 失败 | Web UI 仪表板会显示错误信息;常见原因: VPS 出口 IP 被机场封禁、订阅链接失效 |
| Surge import 失败 | 上传 .conf 时确认编码是 UTF-8 |

---

## 安全建议

- 一定要改 `INITIAL_PASSWORD`,登录后系统会强制再次改密
- Session 密钥首启自动生成在 `data/secret.key`(0600 权限);想强制踢光所有登录态时,删掉这个文件重启容器即可
- 给 Web UI 启用 IP 白名单(在 `data/config.yaml` 中加 `ip_allowlist`)。注意这是**能把自己锁在外面**的开关:
  白名单只保护需登录的管理 API,登录接口不受限,所以症状是「能登录进去,但页面上所有数据都 403」。
  由于 `PUT /api/config` 本身也在白名单后面,填错时只能改服务器上的文件恢复:
  `ip_allowlist: []` 存盘即生效,不用重启容器。
  另外反代必须透传 `X-Forwarded-For` 或 `X-Real-IP`,否则后端拿到的客户端 IP 是 `unknown`,同样全部 403。
- 用 HTTPS 反代,**不要直接暴露 8080 到公网**
- 定期备份 `data/` (但要排除 `config.yaml` 的密码哈希和 `secret.key` 到公开仓库)
- `docker-compose.yml` 若手动指定了 `SESSION_SECRET`,不要传到公开仓库
