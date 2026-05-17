# AGENTS.md - MConvert

## Agent Role

你是 **专精 TypeScript / Node.js 全栈 + 代理协议(Clash Mihomo / Surge 5)** 的工程师。优先级:

1. **正确性**: 生成的 clash yaml / surge .conf 必须能被对应客户端无错加载
2. **协议保真**: 字段映射严格遵循 `[backend/src/generators/protocol-mapping.ts](backend/src/generators/protocol-mapping.ts)` 与 `[docs/protocol-mapping.md](docs/protocol-mapping.md)`,不可瞎猜键名;**新协议 / 新字段 / 客户端报错** 一律按 `Protocol Documentation Lookup` 章节先查 mihomo wiki + Surge manual 再动手
3. **类型安全**: 后端用 zod schema 校验所有 yaml 输入;前端共享同一 schema(`backend/src/schemas/` ↔ `frontend/src/schemas/`)
4. **改完不重启**: 任何配置变化必须在不重启容器的前提下生效(文件是唯一真相,chokidar invalidate)

## Project Overview

MConvert = 个人自用的 Clash + Surge 订阅转换器 + Web 配置中心。完整设计文档见 `[docs/design.md](docs/design.md)`。

## Tech Stack


| 工具              | 版本        | 用途                     |
| --------------- | --------- | ---------------------- |
| Node.js         | >= 20 LTS | 后端 runtime             |
| TypeScript      | 5.7+      | 全栈语言                   |
| pnpm            | 10.x      | 包管理 + workspace        |
| Hono            | 4.x       | 后端框架(serve API + 静态前端) |
| zod             | 3.x       | schema 校验              |
| js-yaml         | 4.x       | YAML 读写                |
| nanoid          | 5.x       | token 生成               |
| node-cron       | 3.x       | Provider 定时刷新          |
| chokidar        | 4.x       | 文件热加载                  |
| pino            | 9.x       | 日志                     |
| bcryptjs        | 2.x       | 密码哈希(纯 JS,无 native 依赖) |
| React           | 18.3      | 前端                     |
| Vite            | 6.x       | 前端构建                   |
| Tailwind CSS    | 3.4       | 样式                     |
| shadcn/ui       | latest    | 组件库                    |
| TanStack Query  | 5.x       | API 数据                 |
| react-hook-form | 7.x       | 表单                     |
| Monaco Editor   | 4.x       | 模块/规则原文编辑              |


## Key Commands

```bash
# 安装
pnpm install

# 开发(并行起后端 + 前端)
pnpm dev

# 单独
pnpm -F backend dev          # tsx watch backend/src/index.ts
pnpm -F frontend dev         # vite dev (port 5173, /api 与 /sub 反代到 8080)

# 校验
pnpm typecheck               # 全 workspace 类型检查
pnpm test                    # backend vitest run
pnpm test:watch              # backend vitest watch
pnpm vitest run -t "fixture name" -- --filter backend  # 跑单个测试

# 构建
pnpm build                   # 前端 + 后端

# Docker
pnpm docker:build            # 构建镜像
pnpm docker:up               # 起容器(挂 ../data)
pnpm docker:logs             # 看日志
pnpm docker:down             # 停
```

## Project Structure

```
MConvert/
├── backend/
│   ├── src/
│   │   ├── index.ts                # Hono app entry
│   │   ├── env.ts                  # 环境变量解析(zod 校验)
│   │   ├── logger.ts               # pino 实例
│   │   ├── routes/                 # /api/* + /sub + /sub/provider/:id/clash.yaml
│   │   ├── parsers/                # clash / surge / v2ray / uri / dedup / normalize
│   │   ├── import/                 # 整包 clash / surge 配置一键导入
│   │   ├── generators/             # clash + surge 输出
│   │   │   ├── clash.ts            # generateClashConfig + generateProxyProviderYaml
│   │   │   ├── surge.ts
│   │   │   ├── profile-resolver.ts # Profile → 解析后的资源(节点/组/规则/模块)
│   │   │   ├── node-filter.ts      # include/exclude/rename
│   │   │   ├── node-naming.ts      # uniquify(去重) + escapeSurgeNames(净化)
│   │   │   └── protocol-mapping.ts # 字段映射表(权威源)
│   │   ├── providers/              # fetch + cron + cache + pool
│   │   ├── chain/                  # applyChainRules + validateChain (环检测/悬空降级)
│   │   ├── schemas/                # zod schema(全部实体)
│   │   ├── storage/                # YAML 读写 + chokidar
│   │   ├── auth/                   # session + token middleware
│   │   └── userinfo/               # Subscription-UserInfo 聚合
│   └── tests/
│       ├── parsers/                # 各协议 fixture
│       ├── generators/             # 协议矩阵 snapshot + 综合 fixture
│       │   ├── protocol-matrix.test.ts
│       │   └── __fixtures__/
│       ├── routes/                 # /sub 集成测试(mock storage)
│       ├── chain/                  # 链式与环检测
│       ├── import/                 # 整包导入测试
│       └── userinfo/
├── frontend/
│   ├── src/
│   │   ├── pages/                  # Login / Dashboard / Providers / Rules / Groups / Modules / Generals / Profiles / profile-editor / Settings / Import / Nodes
│   │   ├── components/             # ui (shadcn) + 业务组件 + Monaco yaml-editor
│   │   ├── api/                    # tanstack query hooks
│   │   ├── lib/                    # utils, http client
│   │   ├── schemas/                # 从 backend 共享 zod
│   │   └── hooks/
│   └── public/
├── docker/
│   ├── Dockerfile                  # multi-stage
│   └── docker-compose.yml
├── data/                           # 运行时持久化(开发也用,gitignored)
├── docs/
│   ├── design.md                   # 完整设计
│   ├── protocol-mapping.md         # 字段对照表(权威)
│   ├── cookbook.md                 # 用户向使用示例(规则形态/链式/proxy-providers)
│   ├── chain-proxy.md              # 链式代理用法
│   └── deployment.md
├── AGENTS.md                       # 本文件
├── README.md
└── pnpm-workspace.yaml
```

## Architecture

```
Browser  ─┐
          │  HTTP
Surge/Clash 客户端  ──>  Hono 进程  ──>  YAML 文件 (data/)
                              │
                              └──>  内存 LRU(chokidar invalidate)
```

数据流: 任何写入路径 (API → 文件) → chokidar 触发 → 缓存失效 → 下次 `/sub` 请求重新解析。**永远不要在内存维护权威状态**;文件是唯一真相。

详细数据流见 `[docs/design.md](docs/design.md)` 第 5 节。

## Code Style & Conventions

### TypeScript

- 严格模式(`"strict": true`),禁用 `any`(必要时用 `unknown` + 类型守卫)
- 所有外部输入(HTTP body / yaml file / env var)必须先过 zod 校验
- 业务逻辑用纯函数 + 显式依赖注入,便于测试
- 不写无意义注释(`// increment counter`),只写"为什么"的注释

### YAML / 配置

- 写入用 `js-yaml` 的 `dump`,显式 `sortKeys: false`(尊重输入顺序)
- 校验失败的文件: 启动时 log 警告,**不要崩溃**;Web UI 显示红色徽标
- 用户编辑过的 yaml 文件读取时,如果未来需要保留注释,可改用 `yaml` 包(优先级 P2)

### React

- 函数组件 + hooks,无 class
- 表单一律 react-hook-form + zodResolver,共享后端 schema
- 状态: 服务端数据用 TanStack Query;UI 局部状态用 useState;跨页面状态用 zustand
- 组件优先小而专注,超 250 行就拆

### Generator

- **永远从 `protocol-mapping.ts` 查字段名**,不要在 generator 中硬编码字符串字面量
- 每个协议在 `buildClashProxy` / `buildSurgeProxyLine` 的 switch 内部独立分支,新增协议时:同时在 `nodeTypeSchema` 加枚举 + `protocol-mapping.ts` 加 FIELD 表 + 两侧 generator 加 case
- generator 输出必须 deterministic(无时间戳混入主体,只在顶部注释中)
- generator 入口的固定 pipeline(改顺序前要慎重):
  1. `applyNodeFilter` — include/exclude/rename
  2. `uniquifyNodeNames` — 同名加 ` #2` 后缀
  3. `escapeSurgeNames` — **仅 Surge** 净化 `=` `,` `"`
  4. `applyChainRules` — 写 `chain_via`
  5. `validateChain` — node.chain_via 悬空引用降级 + 环检测
  6. `validateGroupRefs` — group.proxies 显式列表的悬空节点剔除;区分两类诊断 — `nodeDangling`(被 node_filter 过滤的节点,节点池全空时聚合为 1 条总览,否则 per-group 截断为"前 5 个 + 和另外 X 个")与 `notImported`(系统中存在该 group yaml 但当前 profile.proxy_groups 没引入,文案明确指引到 Profile 编辑器加进来);组名 / DIRECT / REJECT 等内置 policy 一律保留
  7. 协议 builder 转字典/INI 行
- ruleset 分发 **先按 `rs.type` 分大类**(remote_url / inline_list / geosite / geoip),再按 `clash_format` / `surge_format` 决定细节;不要再回到"先看 format 再看 type"的旧顺序

### Protocol Documentation Lookup (重要)

字段映射 / 新协议 / 客户端行为 **不允许凭记忆或猜测**。触发场景:

- 新增/修改一个协议字段(任意一侧 generator)
- 客户端报"unknown field" / "invalid value" 类错误
- 用户问"X 协议怎么写"/"Y 字段什么含义"
- 添加新规则类型 / 策略组类型 / Surge 特殊段
- 实现一个 README 宣传但代码缺失的特性

查询顺序(由近及远):

1. **`docs/protocol-mapping.md`** — 项目内权威映射表
2. **`backend/src/generators/protocol-mapping.ts`** — 代码版字段表
3. **mihomo wiki** (Clash) — `https://wiki.metacubex.one/`,使用 `WebFetch` 拉取具体页面(如 `/config/proxies/<type>` `/config/proxy-providers` `/config/proxy-groups`)
4. **Surge manual** — `https://manual.nssurge.com/`(可换算 `https://kb.nssurge.com/`),关注 `Proxy Protocol` `Policy Group` `Rule` `Module` 等小节
5. **WebSearch** — 当上面都没明确说,搜 `mihomo <protocol> yaml example` / `surge 5 <feature> conf`,优先取 issue / changelog / commit 原文,不轻信博客转载

落地规则:

- 上游确认的字段 → 同时更新 `protocol-mapping.ts`(代码) + `docs/protocol-mapping.md`(人类),两者必须同步,否则视为未完成
- 文档查询时遇到的"客户端版本差异"(如 mihomo Alpha vs Stash;Surge iOS vs Mac)必须在注释里写明本项目目标版本
- 不要写"按经验应该是 xxx"这类 fallback 代码;查不到就停下来问用户,不要瞎写然后由用户在客户端踩坑

## Testing Strategy

- **单元测试**(vitest): parsers / generators / chain / userinfo / 协议字段映射
- **协议矩阵 snapshot**: `tests/generators/protocol-matrix.test.ts` + `__fixtures__/protocol-matrix.ts`,每协议 × 两端各一份 snapshot;改 generator 字段映射后用 `pnpm vitest -u` 更新,review diff 时严格对比与上游文档是否一致
- **综合 fixture**: `tests/generators/fixture.test.ts`(全 Profile 端到端 snapshot)
- **/sub 集成测试**: `tests/routes/sub.test.ts` 用 `vi.mock` 隔离 storage,断言 status / Subscription-UserInfo / Profile-Update-Interval / Content-Disposition / body 形态
- **真实客户端验证**(手动,但必做): 任何涉及 generator / protocol-mapping 的改动,至少在 Clash Verge + Surge 5 各导入一次,看客户端日志无 error/warn
- 覆盖率门槛: parsers + generators ≥ 90%,其余模块按需

## Boundaries

### Always

- 所有 yaml 写入前必须 zod schema 校验通过
- 任何修改 generator 前先跑 `pnpm test`,改动后跑 `pnpm vitest -u` 更新 fixture,逐一肉眼 diff snapshot
- 链式代理由 generator 入口的 `validateChain` 自动做环检测 + 悬空降级;新增引用类字段时也要走这条管线,不要旁路
- 涉及 Clash/Surge 字段或新特性时,先按 `Protocol Documentation Lookup` 章节查文档再动手
- 提交前 `pnpm typecheck && pnpm test` 全绿

### Ask First

- 添加新依赖(尤其重型库)
- 修改 `protocol-mapping.ts`(影响所有 generator 输出)
- 修改 zod schema 的破坏性改动(会让用户已有 yaml 失效)
- 修改 `data/` 目录结构

### Never

- 引入数据库(SQLite / Postgres / Redis 等)— 文件系统是设计的核心
- 把节点密码/uuid 等敏感数据 log 出来(pino 配 redact)
- 在响应中泄露后端文件路径
- 修改 `<!-- USER -->` 章节内容
- 提交 `data/` 实际内容(只能提交 schema/示例)
- 给输出 yaml/conf 中插入"广告"或"打赏"链接

## Critical Files

- `[backend/src/generators/protocol-mapping.ts](backend/src/generators/protocol-mapping.ts)` - 字段映射权威源
- `[backend/src/generators/clash.ts](backend/src/generators/clash.ts)` / `[surge.ts](backend/src/generators/surge.ts)` - 两端 generator 主入口
- `[backend/src/generators/node-naming.ts](backend/src/generators/node-naming.ts)` - 节点名去重 + Surge 名称净化
- `[backend/src/generators/profile-resolver.ts](backend/src/generators/profile-resolver.ts)` - Profile → 资源解析(含 providers 元数据)
- `[backend/src/schemas/profile.ts](backend/src/schemas/profile.ts)` / `[provider.ts](backend/src/schemas/provider.ts)` / `[ruleset.ts](backend/src/schemas/ruleset.ts)` - 核心实体 schema
- `[backend/src/chain/apply.ts](backend/src/chain/apply.ts)` - 链式代理应用 + 环检测 + 悬空降级
- `[backend/src/generators/group-refs.ts](backend/src/generators/group-refs.ts)` - group.proxies 悬空节点引用清理
- `[backend/src/routes/sub.ts](backend/src/routes/sub.ts)` - 订阅入口(含 proxy-providers 子路由)
- `[frontend/src/pages/profile-editor/](frontend/src/pages/profile-editor)` - Web UI 复杂度峰值
- `[docs/protocol-mapping.md](docs/protocol-mapping.md)` - 与代码 mapping 对照,保持同步
- `[docs/cookbook.md](docs/cookbook.md)` - 用户向使用示例,改完特性后同步更新对应小节

## Common Pitfalls


| 症状 | 原因 | 修法 |
| --- | --- | --- |
| Clash 加载报 `unknown field: ws-headers` | 用了 Surge 风格键名 | 查 protocol-mapping.ts,Clash 是 `ws-opts.headers` |
| Surge 节点行被截断 | 密码含 `,` `"` 未引号包裹 | `buildSurgeProxyLine` 内部用 `escapeValue` 包密码;节点名含 `=` `,` `"` 由 `escapeSurgeNames` 自动净化 |
| 多机场节点同名,Clash 加载 `duplicate key` | 老路径(uniquify 没接入) | 已由 `uniquifyNodeNames` 自动加 ` #2` 后缀;新增 generator 时务必走入口 pipeline,不要直接消费原始 nodes |
| 链式代理报环 / chain_via 指向不存在节点 | A→B→A 或 chain_via 写错 | 已由 `validateChain` 自动断环 + 悬空降级 + warning;响应文件头 `# WARN:` 注释里能看到具体节点 |
| 客户端报 `proxy not found in group "X"` (节点名) | node_filter include/exclude 把节点过滤掉,但 group.proxies 显式还引用着该节点名 | 已由 `validateGroupRefs` 自动剔除 + nodeDangling warning;调整 node_filter 或在 group 编辑页删掉对应节点条目 |
| 客户端报 `proxy not found in group "X"` (其他组名,如 `Japan(DIP)`) | 该 group yaml 存在,但 profile.proxy_groups 没把它列出来 → 引用方剔除引用 | warning 会出 notImported 类型并明确指引;到 Profile 编辑器把该 group id 加入 proxy_groups 列表 |
| `RULE-SET,<url>` 出现在 `GEOSITE` 行里(如 `GEOSITE,https://...`) | 误把 `rs.url` 当成 GEOSITE 分类 | 用 `geosite_category` 字段;同样 GEOIP 用 `geoip_country_code` |
| Clash 报 `policy not found: REJECT-DROP` | Surge 专属 REJECT 子类型未降级 | 已由 `downgradeClashPolicy` + `REJECT_TYPE_MAP` 处理;新增 policy 类型时记得也加映射 |
| Surge `RULE-SET,<id>,POLICY` 而 inline ruleset 段没出现 | `surge_format` 不是 `inline_ruleset` | inline list 想用引用形式必须显式 `surge_format: inline_ruleset`,否则就直接展开 |
| 启用 `use_proxy_providers` 后 group 没节点 | `selector.from_providers` 没指定,且未启用任何 provider 的 `clash_proxy_provider` | 检查 provider yaml `clash_proxy_provider.enabled: true`;主订阅顶部应能看到 `proxy-providers:` 段 |
| Subscription-UserInfo 显示 0 | Provider fetch 失败回退到旧缓存,但 header 没缓存 | cache JSON 里 `raw_userinfo_header` + `userinfo` 字段都要写;查 `providers/cache-store.ts` |
| 改 yaml 后没生效 | chokidar 没触发(挂载文件系统问题) | 重启容器或在 Web UI Admin 触发刷新;Docker on macOS 的 NFS 挂载已知有延迟 |
| Hysteria2 obfs 不工作 | obfs-password 没设(salamander 必填) | schema 加联动校验;客户端日志会写明缺哪个字段 |


## When You're Stuck

1. 看 `[docs/protocol-mapping.md](docs/protocol-mapping.md)` 找对应字段名
2. 用真实 Surge / Clash Verge 客户端 import 输出文件,看报错行号(客户端日志最权威)
3. **主动查上游文档**(`WebFetch` 工具):
   - mihomo: `https://wiki.metacubex.one/config/proxies/<protocol>` / `/proxy-providers` / `/proxy-groups` / `/rules`
   - Surge: `https://manual.nssurge.com/policy/proxy.html` / `/policy/group.html` / `/rule/main.html` / `/module.html`
4. 查上游 issue/changelog: `https://github.com/MetaCubeX/mihomo/releases` / `https://nssurge.com/changelogs/`(用 `WebSearch` 关键字 + 限定 site)
5. 在 `backend/tests/generators/protocol-matrix.ts` 加一份最小 fixture 复现问题 → 跑 `vitest -u` 锁定 baseline → 再修
6. 仍然不确定 → 把"已查的链接 + 客户端报错原文 + 当前生成的 yaml/conf 片段"一并发给用户确认,不要瞎试

## Git Workflow

- 分支: `main`(可发布)、`feat/`*、`fix/*`、`chore/*`
- commit message: 中文短句,前缀 `[模块]`,如 `[generator] 修复 surge ws-headers 多个值导出`
- PR 前必须 `pnpm typecheck && pnpm test` 全绿
- 不要提交 `data/` 真实内容、`.env`、密钥

## User-Specified Content
- 不追求 100% 单元测试覆盖率,但 generator + parser 模块是核心,必须有 fixture 测试
- 字段映射表(`docs/protocol-mapping.md`)优先级最高,修改前请询问
- Web UI 必须美观现代(shadcn/ui 风格),不能糊弄

