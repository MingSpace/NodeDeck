# AGENTS.md - NodeDeck

## Agent Role

你是 **专精 TypeScript / Node.js 全栈 + 代理协议(Clash Mihomo / Surge,目标 iOS 5.21+ / Mac 6.8+)** 的工程师。优先级:

1. **正确性**: 生成的 clash yaml / surge .conf 必须能被对应客户端无错加载
2. **协议保真**: 字段映射不可瞎猜键名,一律按 `Protocol Documentation Lookup` 章节办
3. **类型安全**: 后端用 zod schema 校验所有外部输入(HTTP body / yaml 文件 / env);**前端目前不跑 zod**,校验只在后端一侧,前端靠"提交后读后端报错"兜底(见 `React` 小节)
4. **改完不重启**: 任何配置变化必须在不重启容器的前提下生效(文件是唯一真相,chokidar invalidate)

## Project Overview

NodeDeck = 个人自用的 Clash + Surge 订阅转换器 + Web 配置中心。完整设计文档见 `[docs/design.md](docs/design.md)`。

## Tech Stack


| 工具               | 版本        | 用途                       |
| ---------------- | --------- | ------------------------ |
| Node.js          | >= 20 LTS | 后端 runtime               |
| TypeScript       | 5.7+      | 全栈语言                     |
| pnpm             | 10.x      | 包管理 + workspace          |
| Hono             | 4.x       | 后端框架(serve API + 静态前端)   |
| zod              | 3.x       | schema 校验(**仅后端**)       |
| js-yaml          | 4.x       | YAML 读写(前后端都用)           |
| nanoid           | 5.x       | token 生成                 |
| node-cron        | 3.x       | Provider 定时刷新            |
| chokidar         | 4.x       | 文件热加载                    |
| pino             | 9.x       | 日志                       |
| bcryptjs         | 2.x       | 密码哈希(纯 JS,无 native 依赖)   |
| vitest           | 2.x       | 后端单测 + snapshot(只装在 backend) |
| ESLint           | 9.x       | 扁平配置 + typescript-eslint 8.x   |
| React            | 18.3      | 前端                       |
| react-router-dom | 7.x       | 前端路由(见 `frontend/src/App.tsx`) |
| Vite             | 6.x       | 前端构建                     |
| Tailwind CSS     | 3.4       | 样式                       |
| shadcn/ui        | latest    | 组件库                      |
| TanStack Query   | 5.x       | API 数据                   |
| @dnd-kit         | 6.x       | 规则/组成员/链式规则拖拽排序          |
| zustand          | 5.x       | 目前仅 toast store          |
| node-forge       | 1.x       | 前端生成 MITM CA 证书          |
| Monaco Editor    | 4.x       | 模块/规则原文编辑                |

> `frontend/package.json` 里的 `react-hook-form` / `@hookform/resolvers` / `zod` 是**历史遗留的未使用依赖**,前端源码零引用;不要因为看到依赖就按它们的范式写新代码。


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
pnpm lint                    # eslint 扁平配置(eslint.config.js),--max-warnings 0
pnpm test                    # backend vitest run(38 个文件 / 600+ 用例,约 3s)
pnpm test:watch              # backend vitest watch

# vitest 只装在 backend,root 没有 vitest bin —— `pnpm vitest ...` 会报
# ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "vitest" not found,必须用 -F backend exec
pnpm -F backend exec vitest run -t "fixture name"   # 跑单个测试
pnpm -F backend exec vitest run -u                  # 更新 snapshot
pnpm -F backend exec vitest run --coverage          # 覆盖率

# 构建
pnpm build                   # 前端 + 后端

# Docker(部署侧,本地开发请用 pnpm dev)
# 镜像由 GitHub Actions 自动构建并推送 ghcr.io/mingspace/nodedeck
# 服务器只 pull,不在仓库本地 build;详见 docs/deployment.md
```

## Local Dev Environment (优先复用,不要瞎起)

开发机是 **macOS**,用户通常常驻一个 `pnpm dev`(frontend:5173 / backend:8080,vite 把 `/api` 与 `/sub` 反代到 8080)。**起任何 dev 命令之前先按下面顺序探测,已经在跑就直接复用**(双开 vite 端口冲突,双开 tsx watch 会重复编译 + 抢文件)。

1. **终端文件**(最可靠): 读 `~/.cursor/projects/Users-minghui-Code-NodeDeck/terminals/*.txt` 的头部元数据,找 `command:` 含 `pnpm dev` / `vite` / `tsx watch` 且 `status` 仍在运行的条目;注意里面可能同时存在已经退出的旧条目,要看 `status` / `running_for_ms` 而不是只看 command
2. **端口监听**: `lsof -nP -iTCP -sTCP:LISTEN | grep -E '5173|8080'`(macOS 没有 `ss` / `netstat -tlnp`)
3. **HTTP 探活**: `curl -sS -o /dev/null -w "%{http_code}\n" --max-time 5 http://localhost:5173/` 与 `http://localhost:8080/api/health`,200 即可用

三步全失败才需要起新进程,起之前先问一句"本地没探测到 dev server,要我帮你起吗?"。

### 前端 UI 验证(`cursor-ide-browser`)

- **只要状态码 / API JSON / HTML 骨架** → 直接 `curl http://localhost:5173/<route>` 或 `http://localhost:8080/api/<path>`,不需要浏览器
- **要看渲染后的 DOM / 截图 / 控制台报错** → 用 `cursor-ide-browser` 的 `browser_navigate` / `browser_snapshot` / `browser_take_screenshot`;**控制台和网络请求没有专用工具**(不存在 `browser_console_messages`),要用 `browser_cdp` 配 `Log.enable` / `Runtime.evaluate` / `Network.enable`

调用要点:

- 需要浏览器时**先自己调 `browser_tabs` action="list" 探活**:能返回(哪怕是空列表)就是已激活,直接继续;只有报 `Tool not found` 才请用户发一次 `@Browser` mention 激活。激活后在会话内是粘性的,不用每轮都 mention;新会话仍先探活再判断,不要预设"没激活"
- 探活失败时不要试"绕过"方案 —— 查 MCP 日志、翻 `tools/*.json`(本来就是空的,工具按 mention 动态注入)、spawn subagent 代调(工具只 lease 给当前 parent 上下文)全都是死路
- 任何改变页面结构的动作(`browser_navigate` / `browser_click` / `browser_fill`)之后,下一步交互前要重新 `browser_snapshot` 拿 fresh ref
- 多步连续交互前 `browser_lock` action="lock",收尾 `action="unlock"`;单次"打开 + 截图"不用 lock
- 优先用 snapshot 的 ARIA ref 点击,**避免** `browser_mouse_click_xy` 坐标点击(除非 DOM 交互失败)

## Project Structure

```
NodeDeck/
├── backend/
│   ├── src/
│   │   ├── index.ts                # Hono app entry(含 /health 与 SPA fallback)
│   │   ├── env.ts                  # 环境变量解析(zod 校验)
│   │   ├── logger.ts               # pino 实例
│   │   ├── log-buffer.ts           # pino 行 → 结构化内存缓冲(Web UI 日志页 + SSE)
│   │   ├── log-store.ts            # 按日 NDJSON 落盘 data/logs/,retention_days 热生效
│   │   ├── routes/
│   │   │   ├── sub.ts              # /sub、/sub/{clash,surge}/:profile、/sub/provider/:id/clash.yaml
│   │   │   ├── api.ts              # /api/health、/api/version + 各子路由装配 + session/IP 白名单挂载点
│   │   │   ├── entities.ts         # 各实体 CRUD
│   │   │   ├── profile-preview.ts  # Web UI 实时预览 + 链式诊断
│   │   │   ├── provider-actions.ts # status / :id/nodes / :id/refresh / :id/extracted-hosts / refresh-all
│   │   │   └── dashboard.ts / logs.ts / notification.ts / config.ts / import.ts / auth.ts
│   │   ├── parsers/                # clash / surge / v2ray / uri / dedup / normalize / info-node-filter
│   │   ├── import/                 # 整包 clash / surge 导入 + extract-hosts + dedup-pool
│   │   ├── generators/             # clash + surge 输出
│   │   │   ├── clash.ts            # generateClashConfig + generateProxyProviderYaml
│   │   │   ├── surge.ts
│   │   │   ├── profile-resolver.ts # Profile → 解析后的资源(节点/组/规则/模块)
│   │   │   ├── node-filter.ts      # include/exclude/rename
│   │   │   ├── node-sort.ts        # sortNodesByRegion(sort_by_region 开关)
│   │   │   ├── node-naming.ts      # uniquify(去重) + escapeSurgeNames(净化)
│   │   │   ├── group-members.ts    # selector→节点池 + 组成员索引
│   │   │   ├── group-refs.ts       # group.proxies 悬空引用清理
│   │   │   ├── hosts.ts            # hosts 合并 + splitClashHosts
│   │   │   └── protocol-mapping.ts # 字段映射表(权威源)
│   │   ├── providers/              # fetcher / scheduler(cron) / cache-store / pool / load
│   │   ├── chain/apply.ts          # applyChainRules + validateChain + 诊断
│   │   ├── notifications/          # bark / checks / service / state(订阅到期与刷新失败告警)
│   │   ├── schemas/                # zod schema(全部实体)
│   │   ├── storage/                # YAML 读写 + chokidar watcher + cache + reset
│   │   ├── auth/                   # session / token / rate-limit / secret middleware
│   │   └── userinfo/               # Subscription-UserInfo 聚合
│   └── tests/                      # 与 src 同构:parsers / generators / chain / import /
│                                   # routes / providers / notifications / auth / schemas /
│                                   # storage / userinfo;generators 下有 __fixtures__ + __snapshots__
├── frontend/
│   ├── src/
│   │   ├── App.tsx                 # react-router 路由表(权威页面清单)
│   │   ├── pages/                  # login / dashboard / providers / nodes / rules / groups /
│   │   │                           # modules / generals / profile-editor(profiles/:id) /
│   │   │                           # settings / import / notifications / logs
│   │   ├── components/             # ui (shadcn) + layout + 业务组件 + Monaco yaml-editor
│   │   ├── api/                    # tanstack query hooks(entities / logs)
│   │   ├── lib/                    # http client, utils, line-diff, relative-time
│   │   └── hooks/                  # use-auth
│   └── public/
├── docker/
│   ├── Dockerfile                  # multi-stage
│   └── docker-compose.yml
├── data/                           # 运行时持久化(开发也用,gitignored)
├── docs/
│   ├── design.md                   # 完整设计(第 4 节 = 处理流水线)
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

详细数据流见 `[docs/design.md](docs/design.md)` **第 4 节「处理流水线」**(第 5 节讲的是 Generator 输出形态)。

## Code Style & Conventions

### TypeScript

- 严格模式(`"strict": true`),禁用 `any`(必要时用 `unknown` + 类型守卫)
- 所有外部输入(HTTP body / yaml file / env var)必须先过 zod 校验
- 业务逻辑用纯函数 + 显式依赖注入,便于测试
- 不写无意义注释(`// increment counter`),只写"为什么"的注释
- 故意不用的解构占位一律 `_` 前缀(`const { chain_via: _omit, ...rest }`),tsc 与 lint 都按这个约定放行

### Lint(`eslint.config.js`)

- **类型感知规则只覆盖 `backend/src` 与 `frontend/src`** —— `backend/tsconfig.json` 显式 exclude 了 tests,给 tests/构建脚本开类型感知会直接解析报错;它们只跑纯语法规则
- 刻意没上 `recommendedTypeChecked` 全家桶:js-yaml 的 `load()` 返回 `any`,`no-unsafe-*` 会在 parsers/storage 刷上百条噪音。只留了 promise 相关三条(`no-floating-promises` / `no-misused-promises` / `await-thenable`)
- 想加规则先想清楚存量代价,别为了开一条规则去批量改业务代码
- 目前**没装 `eslint-plugin-react-hooks`**,所以 `react-hooks/exhaustive-deps` 这类 disable 注释写了会报"规则不存在";要用得先加依赖(属于 Ask First)

### YAML / 配置

- 写入用 `js-yaml` 的 `dump`,显式 `sortKeys: false`(尊重输入顺序)
- 校验失败的文件: 启动时 log 警告,**不要崩溃**;Web UI 显示红色徽标
- 用户编辑过的 yaml 文件读取时,如果未来需要保留注释,可改用 `yaml` 包(优先级 P2)

### React

- 函数组件 + hooks,无 class
- **表单是手写受控组件 + `useState`,没有 react-hook-form,也没有前端 zod 校验**;前端只做轻量的必填/格式提示,权威校验在后端 schema,失败靠 toast 展示后端报错。跨端约定用注释锚定(如 `// 与 backend/src/schemas/notification.ts 保持同步`),改后端 schema 时要顺手 grep 这类注释
- 状态: 服务端数据用 TanStack Query;局部状态用 useState;zustand 目前只有 `components/ui/toast.tsx` 一个 store,没有跨页面全局 store,新增前先想清楚是否真的需要
- fire-and-forget 的 promise(`invalidateQueries` / `navigate` / `refetch`)要显式 `void` 前缀,否则过不了 `no-floating-promises`;真的需要等它完成就老实 `await`
- 组件小而专注:**新文件超 400 行就拆**。存量有一批超标文件(`pages/providers/index.tsx` 786、`pages/groups/proxy-list-editor.tsx` 762、`pages/providers/visual-form.tsx` 573 等),**不要顺手重构它们** —— 只在本来就要改那块逻辑时才拆

### Generator

- **永远从 `protocol-mapping.ts` 查字段名**,不要在 generator 中硬编码字符串字面量
- 每个协议在 `buildClashProxy` / `buildSurgeProxyLine` 的 switch 内部独立分支,新增协议时:同时在 `nodeTypeSchema` 加枚举 + `protocol-mapping.ts` 加 FIELD 表 + 两侧 generator 加 case
- generator 输出必须 deterministic(无时间戳混入主体,只在顶部注释中)
- generator 入口的固定 pipeline(`clash.ts` / `surge.ts` 两端必须一致,改顺序前要慎重):
  1. `applyNodeFilter` — include/exclude/rename
  2. `sortNodesByRegion` — 仅当 `profile.node_filter.sort_by_region` 打开;必须在 uniquify **之前**,否则去重后缀会跟着顺序变动而抖
  3. `uniquifyNodeNames` — 撞名加来源前缀,回退 ` #2` 后缀
  4. `escapeSurgeNames` — **仅 Surge** 净化 `=` `,` `"`
  5. `resolveHiddenNodeNames` — `profile.hidden_nodes`(可选)命中的节点仍进 `proxies` / `[Proxy]`(所以 `chain_via` 指得到),但从两端 `resolveGroupMembers` 与 `buildGroupMemberIndex` 的 **selector 动态匹配**里剔除;`group.proxies` 显式点名保留。判定复用 `chain/apply.ts` 的 `matchesSelector`,但**全空 = 不隐藏**(与 chain selector 相反)
 6. `applyChainRules` — 写 `chain_via`;selector 支持按策略组成员(`include_groups`)/ 点名节点(`include_nodes`)圈定,两者 OR、与其余条件 AND,所需的「组 name → 成员节点名」索引由 `generators/group-members.ts` 的 `buildGroupMemberIndex` 在入口现算(与写进产物的组成员同源)。每条规则有 `enabled` 与 `mode`(`override` / `fill`);**一个节点只能有一条链**(两端字段都是每节点单值),命中多条以最靠前为准
  7. `validateChain` — node.chain_via 悬空引用降级 + 环检测
  8. `validateGroupRefs` — group.proxies 显式列表的悬空节点剔除;区分两类诊断 — `nodeDangling`(被 node_filter 过滤的节点,节点池全空时聚合为 1 条总览,否则 per-group 截断为"前 5 个 + 和另外 X 个")与 `notImported`(系统中存在该 group yaml 但当前 profile.proxy_groups 没引入,文案明确指引到 Profile 编辑器加进来);组名 / DIRECT / REJECT 等内置 policy 一律保留
  9. 协议 builder 转字典/INI 行
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
5. **WebSearch** — 当上面都没明确说,搜 `mihomo <protocol> yaml example` / `surge <feature> conf`,优先取 issue / changelog / commit 原文,不轻信博客转载

落地规则:

- 上游确认的字段 → 同时更新 `protocol-mapping.ts`(代码) + `docs/protocol-mapping.md`(人类),两者必须同步,否则视为未完成
- 文档查询时遇到的"客户端版本差异"(如 mihomo Alpha vs Stash;Surge iOS vs Mac)必须在注释里写明本项目目标版本
- 不要写"按经验应该是 xxx"这类 fallback 代码;查不到就停下来问用户,不要瞎写然后由用户在客户端踩坑

## Testing Strategy

测试只在 backend 一侧(前端无测试)。当前基线:38 个文件 / 600+ 用例,`pnpm test` 约 3 秒跑完。

- **单元测试**(vitest): parsers / generators / chain / import / providers / notifications / auth / schemas / storage / userinfo
- **协议矩阵 snapshot**: `tests/generators/protocol-matrix.test.ts` + `tests/generators/__fixtures__/protocol-matrix.ts`,每协议 × 两端各一份 snapshot;改字段映射后用 `pnpm -F backend exec vitest run -u` 更新,review diff 时逐条比对上游文档
- **综合 fixture**: `tests/generators/fixture.test.ts`(全 Profile 端到端 snapshot,输入在 `__fixtures__/example-profile.input.ts`)
- **/sub 集成测试**: `tests/routes/sub.test.ts` 用 `vi.mock` 隔离 storage,断言 status / Subscription-UserInfo / Profile-Update-Interval / Content-Disposition / body 形态
- **真实客户端验证**(手动,但必做): 任何涉及 generator / protocol-mapping 的改动,至少在 Clash Verge + Surge(最新版)各导入一次,看客户端日志无 error/warn
- 覆盖率是**目标不是门槛**(CI 不卡):parsers + generators 尽量 ≥ 90%,其余按需;要看数据跑 `pnpm -F backend exec vitest run --coverage`

## Boundaries

### Always

- 所有 yaml 写入前必须 zod schema 校验通过
- 改 generator 前先跑一遍 `pnpm test` 拿到干净基线(snapshot 更新流程见 `Testing Strategy`)
- 引用类字段(节点/组/规则互指)一律走 generator 入口的 `validateChain` / `validateGroupRefs` 管线做悬空降级与环检测,不要旁路自己判
- 涉及 Clash/Surge 字段或新特性时,先按 `Protocol Documentation Lookup` 查文档再动手
- 提交前 `pnpm typecheck && pnpm lint && pnpm test` 全绿

### Ask First

- 添加新依赖(尤其重型库)
- 修改 `protocol-mapping.ts`(影响所有 generator 输出)
- 修改 zod schema 的破坏性改动(会让用户已有 yaml 失效)
- 修改 `data/` 目录结构

### Never

- 引入数据库(SQLite / Postgres / Redis 等)— 文件系统是设计的核心
- 把节点密码/uuid 等敏感数据 log 出来(pino 配 redact)
- 把任何敏感信息(节点密码 / uuid / 订阅 token / 机场真实订阅 URL / API key / cookie)硬编码进源代码、测试 fixture、文档示例或 commit —— 开源仓库 git 历史不可抹除,真实订阅地址等同长期泄露;测试 / 文档一律用占位假数据(如 `example.com` / `your-token-here`)
- 在响应中泄露后端文件路径
- 修改 `## User-Specified Content` 章节内容(用户自己维护)
- 提交 `data/` 实际内容(只能提交 schema/示例)、`.env`、任何密钥
- 给输出 yaml/conf 中插入"广告"或"打赏"链接

## Critical Files

- `[backend/src/generators/protocol-mapping.ts](backend/src/generators/protocol-mapping.ts)` - 字段映射权威源
- `[backend/src/generators/clash.ts](backend/src/generators/clash.ts)` / `[surge.ts](backend/src/generators/surge.ts)` - 两端 generator 主入口
- `[backend/src/generators/node-naming.ts](backend/src/generators/node-naming.ts)` - 节点名去重 + Surge 名称净化
- `[backend/src/generators/profile-resolver.ts](backend/src/generators/profile-resolver.ts)` - Profile → 资源解析(含 providers 元数据)
- `[backend/src/schemas/profile.ts](backend/src/schemas/profile.ts)` / `[provider.ts](backend/src/schemas/provider.ts)` / `[ruleset.ts](backend/src/schemas/ruleset.ts)` - 核心实体 schema
- `[backend/src/chain/apply.ts](backend/src/chain/apply.ts)` - 链式代理应用 + 环检测 + 悬空降级 + 命中诊断(`analyzeChainRules` / `resolveChainPaths`,供 Web UI 实时反馈)
- `[backend/src/generators/group-members.ts](backend/src/generators/group-members.ts)` - selector→节点池筛选 + 组成员索引(clash / surge / chain 三处共用,改这里会同时影响组成员与链式作用域)
- `[backend/src/generators/hidden-nodes.ts](backend/src/generators/hidden-nodes.ts)` - `profile.hidden_nodes` 解析(「仅作链式落地、不可直接选择」的节点集合)
- `[backend/src/generators/group-refs.ts](backend/src/generators/group-refs.ts)` - group.proxies 悬空节点引用清理
- `[backend/src/routes/sub.ts](backend/src/routes/sub.ts)` - 订阅入口(含 proxy-providers 子路由)
- `[backend/src/routes/profile-preview.ts](backend/src/routes/profile-preview.ts)` - Web UI 实时预览 + 链式/组引用诊断的唯一后端来源,改 generator 诊断输出时要同步看它
- `[frontend/src/pages/profile-editor/](frontend/src/pages/profile-editor)` - Web UI 复杂度峰值
- `[docs/protocol-mapping.md](docs/protocol-mapping.md)` - 与代码 mapping 对照,保持同步
- `[docs/cookbook.md](docs/cookbook.md)` - 用户向使用示例,改完特性后同步更新对应小节

## Common Pitfalls


| 症状 | 原因 | 修法 |
| --- | --- | --- |
| Clash 加载报 `unknown field: ws-headers` | 用了 Surge 风格键名 | 查 protocol-mapping.ts,Clash 是 `ws-opts.headers` |
| Surge 节点行被截断 | 密码含 `,` `"` 未引号包裹 | `buildSurgeProxyLine` 内部用 `escapeValue` 包密码;节点名含 `=` `,` `"` 由 `escapeSurgeNames` 自动净化 |
| 多机场节点同名,Clash 加载 `duplicate key` | 老路径(uniquify 没接入) | 已由 `uniquifyNodeNames` 自动给撞名节点加来源前缀 `【tag或首字母】`(查不到来源 / 前缀后仍撞名时回退 ` #2` 后缀);新增 generator 时务必走入口 pipeline 并传 providers,不要直接消费原始 nodes |
| 链式代理报环 / chain_via 指向不存在节点 | A→B→A 或 chain_via 写错 | 已由 `validateChain` 自动断环 + 悬空降级 + warning;响应文件头 `# WARN:` 注释里能看到具体节点 |
| 客户端报 `proxy not found in group "X"` (节点名) | node_filter include/exclude 把节点过滤掉,但 group.proxies 显式还引用着该节点名 | 已由 `validateGroupRefs` 自动剔除 + nodeDangling warning;调整 node_filter 或在 group 编辑页删掉对应节点条目 |
| 配了 `hidden_nodes` 但节点在客户端仍可直接选 | ① 某个 group 的 `proxies` 显式点名了它(设计如此,显式优先);② Clash `use_proxy_providers` 模式下组靠 `use:` 引用整个机场,成员由客户端展开;③ Surge 组开了 `include_all_proxies` / `policy_regex_filter` | ①按预期,不想要就从该组成员里删掉;②③ 属客户端侧展开,本地过滤不到 —— ② 生成时会给 warning |
| 客户端报 `proxy not found in group "X"` (其他组名,如 `Japan(DIP)`) | 该 group yaml 存在,但 profile.proxy_groups 没把它列出来 → 引用方剔除引用 | warning 会出 notImported 类型并明确指引;到 Profile 编辑器把该 group id 加入 proxy_groups 列表 |
| `RULE-SET,<url>` 出现在 `GEOSITE` 行里(如 `GEOSITE,https://...`) | 误把 `rs.url` 当成 GEOSITE 分类 | 用 `geosite_category` 字段;同样 GEOIP 用 `geoip_country_code` |
| Clash 报 `policy not found: REJECT-DROP` | Surge 专属 REJECT 子类型未降级 | 已由 `downgradeClashPolicy` + `REJECT_TYPE_MAP` 处理;新增 policy 类型时记得也加映射 |
| Surge `RULE-SET,<id>,POLICY` 而 inline ruleset 段没出现 | `surge_format` 不是 `inline_ruleset` | inline list 想用引用形式必须显式 `surge_format: inline_ruleset`,否则就直接展开 |
| 启用 `use_proxy_providers` 后 group 没节点 | `selector.from_providers` 没指定,且未启用任何 provider 的 `clash_proxy_provider` | 检查 provider yaml `clash_proxy_provider.enabled: true`;主订阅顶部应能看到 `proxy-providers:` 段 |
| Subscription-UserInfo 显示 0 | Provider fetch 失败回退到旧缓存,但 header 没缓存 | cache JSON 里 `raw_userinfo_header` + `userinfo` 字段都要写;查 `providers/cache-store.ts` |
| 能登录,但登录后所有 `/api/*` 全 403 | `ip_allowlist` 非空却匹配不上客户端 IP(`/api/auth/*` 不受白名单约束,所以只有登录是通的);常见来源:设置页点了「新增」没填就保存留下空条目、CIDR 写错、反代没透传 `X-Forwarded-For`/`X-Real-IP` 导致 IP 是 `unknown` | 后端日志搜 `Blocked by IP allowlist` 能看到被判定的 IP;空/非法条目已由 `schemas/config.ts` 清洗 + `PUT /api/config` 校验拦截,存量坏配置改 `data/config.yaml` 为 `ip_allowlist: []` 即热生效 |
| 改 yaml 后没生效 | chokidar 没触发(挂载文件系统问题) | 重启容器或在 Web UI Admin 触发刷新;Docker on macOS 的 NFS 挂载已知有延迟 |
| Hysteria2 obfs 不工作 | obfs-password 没设(salamander 必填) | schema 加联动校验;客户端日志会写明缺哪个字段 |
| host 的 `server:` 在 Clash 不生效 | generals DNS 的 `proxy-server-nameserver` 为空,而 `proxy-server-nameserver-policy` 需它非空才生效 | 在 generals DNS 填 `proxy-server-nameserver`(通用 DoH);`server:` 由 `splitClashHosts` 投到 `dns.proxy-server-nameserver-policy`(`*.`→`+.`),`DOMAIN-SET:`/`RULE-SET:` 仍跳过 + warning(`backend/src/generators/hosts.ts`) |
| provider / 机场 `[Host]`、`hosts:` 段没带进订阅 | ① provider `emit_hosts` 关了或该源被禁用;② 上游 host 的 key 与本源节点 server 域名无关,被有意过滤(本项目只带**节点域名相关**的 host) | 输出 hosts = `general.hosts` + 各启用源手动 `provider.hosts` + 各源自动解析的 `cache.extracted_hosts`,由 `mergeHostMaps` 去重合并;自动解析由 `deriveProviderHostOverrides`(`import/extract-hosts.ts`)在每次刷新时只挑两类:① Clash 顶层 `hosts:` / Surge `[Host]` 中命中本源节点 server 域名(精确 + 通配父域)的条目;② Surge `encrypted-dns-server`(机场自建 DoH)为每个域名型节点推导 `节点域名 = server:<DoH>`。无关条目丢弃、节点 server 为 IP 跳过;`profile-resolver` 按 `emit_hosts` 并入(编辑页「节点源 Host」区有只读预览,`GET /api/providers/:id/extracted-hosts`)。base64/uri 列表无 hosts 段、节点全 IP 解析为空都属正常 |
| 节点源报「content 为空(…上游仍返回空 body)」 | 机场按 User-Agent 网关,Surge 系 UA 返回 200 + 空 body(实测部分机场即此) | 默认 `user_agent` 已改空字符串,fetcher 拿到空 body 会自动回退 `clash-verge`/`ClashMeta`/`mihomo` 等 UA 重试(`providers/fetcher.ts` 的 `FALLBACK_USER_AGENTS`);仍全空则订阅多半失效或需特定 UA,可在节点源手动指定 User-Agent |


## When You're Stuck

1. 按 `Protocol Documentation Lookup` 的顺序查文档(项目映射表 → mihomo wiki → Surge manual → 上游 issue/changelog)
2. 用真实 Surge / Clash Verge 客户端 import 输出文件,看报错行号 —— 客户端日志最权威
3. 在 `backend/tests/generators/__fixtures__/protocol-matrix.ts` 加一份最小 fixture 复现问题 → `pnpm -F backend exec vitest run -u` 锁定 baseline → 再修
4. 仍然不确定 → 把"已查的链接 + 客户端报错原文 + 当前生成的 yaml/conf 片段"一并发给用户确认,不要瞎试

## Git Workflow

- 分支: `main`(可发布)、`feat/*`、`fix/*`、`chore/*`
- commit message: 中文短句,前缀 `[模块]`,如 `[generator] 修复 surge ws-headers 多个值导出`
- PR 前必须 `pnpm typecheck && pnpm lint && pnpm test` 全绿

## User-Specified Content
- 不追求 100% 单元测试覆盖率,但 generator + parser 模块是核心,必须有 fixture 测试
- 字段映射表(`docs/protocol-mapping.md`)优先级最高,修改前请询问
- Web UI 必须美观现代(shadcn/ui 风格),不能糊弄

