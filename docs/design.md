# NodeDeck 设计概览

> 本文档是设计的简明速览,完整版本请见 `.cursor/plans/nodedeck_设计方案_*.plan.md`。

---

## 1. 定位

- 个人自用的 Clash + Surge 订阅转换器
- 不支持 quanx/loon/v2rayn 等其他客户端输出
- 单 Docker 镜像 + 文件系统持久化 + 改完不重启

## 2. 技术栈

- **后端**: Node.js 20+ + TypeScript + Hono + zod + chokidar
- **前端**: React 18 + Vite + Tailwind + shadcn-style components + TanStack Query + Monaco
- **持久化**: 文件系统 (YAML + JSON),挂载到 Docker volume

## 3. 数据模型

存放在 `data/` 目录:

```
data/
  config.yaml              # 全局配置(admin 密码哈希、IP 白名单等)
  providers/*.yaml         # 节点源:订阅 URL / 服务器本地文件 / 静态节点(inline 类型,含手输 / 导入节点)
  rules/*.yaml             # 规则模块
  groups/*.yaml            # 策略组模板
  modules/*.yaml           # Surge 模块([MITM]/[URL Rewrite]/...)
  general/*.yaml           # General + Host + SSID + DNS + MITM 预设
  profiles/*.yaml          # Profile 拼装单元
  cache/<provider>.json    # 订阅源 fetch 缓存(节点 + Subscription-UserInfo)
  logs/YYYY-MM-DD.log      # 进程日志(NDJSON,按本地日期切分,保留天数见 config.yaml 的 logs.retention_days)
```

> 注: 手动添加节点 / 从其它客户端导入的节点 一律走 `type: inline` Provider —
> 没有独立的 `manual-nodes.yaml`。每次 `/api/import/commit` 会把去重后存活的节点
> 打包成一个新的 inline Provider 落到 `providers/imported-*.yaml`。

每个实体都有 zod schema(见 `backend/src/schemas/`),YAML 写入前必须通过校验。

## 4. 处理流水线

```
Providers → Fetch + Cache → Parse → Normalize (region/level/line tag)
         → Dedup (sha1 of type+server+port+secret, keep-first)
         → Profile Filter + Rename (node_filter: include/exclude/rename)
         → [可选] sort_by_region 地区聚类
         → uniquifyNodeNames (撞名加来源前缀)
         → [仅 Surge] escapeSurgeNames (净化 = , ")
         → applyChainRules (写 chain_via)
         → validateChain (悬空降级 + 环检测)
         → validateGroupRefs (剔除 group.proxies 里的悬空引用)
         → Output Generator (Clash YAML / Surge .conf)
```

## 5. 输出 Generator

- `clash.ts`: 生成 Mihomo 兼容 YAML,完整 proxies/proxy-groups/rule-providers/dns/tun
- `surge.ts`: 生成 Surge .conf,完整段顺序 + #!MANAGED-CONFIG + RULE-SET flags + REJECT 子类型 + inline ruleset + module 合并 + MITM + MTProto(Telegram 入站代理)
- 共享 `protocol-mapping.ts` 作为字段映射权威源

详见 [`protocol-mapping.md`](protocol-mapping.md)。

## 6. 链式代理

`Profile.chain_rules` 顺序匹配 selector,首条命中给节点写 `chain_via`:

- Clash 输出 → `dialer-proxy: <name>`
- Surge 输出 → `underlying-proxy=<name>`

作用域可按**策略组成员**(`include_groups`)、**点名节点**(`include_nodes`)、机场、地区、协议、
名称正则圈定;前两者之间是 OR,与其余条件之间是 AND。按组圈定所需的"组 name → 成员节点名"索引由
`generators/group-members.ts` 的 `buildGroupMemberIndex` 在 generator 入口计算(与写进产物的组成员同源)。
每条规则另有 `enabled` 开关与 `mode`(`override` 覆盖 / `fill` 仅补空缺)。

由于两端的链式字段都是**每节点单值**,一个节点只能有一条链 —— 命中多条时以最靠前的为准,
Web UI 会把冲突和"被遮蔽"的规则显式标出来(`POST /api/profiles/:id/chain-preview`)。

generator 入口会做两层校验:
1. **悬空引用**: chain_via 指向的节点/组若不存在(或被 `node_filter` 排除),自动清空该字段并 warning。
2. **环检测**: A→B→A 的环被发现后,把环上所有节点的 chain_via 清空并 warning,不再让用户看到 500。

详见 [`chain-proxy.md`](chain-proxy.md)。

## 7. 流量信息聚合

每个 Provider 拉取时缓存原始 `Subscription-UserInfo` header。Profile 输出时:

- **总开关 `userinfo.enabled`**: **默认关闭**;关闭时 `/sub` 完全跳过聚合分支,不读 cache 也不写任何相关响应头
- **标准 header `Subscription-UserInfo`**: 按 `userinfo.mode` 聚合(`primary` / `sum`)
- **自定义 header `X-NodeDeck-Userinfo-{provider_id}`**: 每机场一条,完整原文(`expose_per_provider_headers` 控制)
- **Web UI 仪表板**: 卡片网格,单机场流量进度条 + 到期倒计时 + 阈值告警

## 8. URL + 鉴权

- 订阅: `GET /sub?profile={id}&target={clash|surge}&t={token}` (token 12 字符 nanoid)
- Web UI: cookie session(HMAC),首次登录强制改密
- 可选 IP 白名单(`ip_allowlist`):只保护**需登录的管理 API**(`/api/entities|providers|dashboard|import|profiles|config|notification|logs`);登录接口 `/api/auth/*`、健康检查 `/api/health`/`/api/version`、静态前端 `/` 与订阅 `/sub` 均**不受**其约束

## 9. 部署

详见 [`deployment.md`](deployment.md)。

## 10. 给 AI 协作者

详见 [`../AGENTS.md`](../AGENTS.md)。
