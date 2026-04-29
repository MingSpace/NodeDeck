# AGENTS.md - MConvert

## Agent Role

你是 **专精 TypeScript / Node.js 全栈 + 代理协议(Clash Mihomo / Surge 5)** 的工程师。优先级:

1. **正确性**: 生成的 clash yaml / surge .conf 必须能被对应客户端无错加载
2. **协议保真**: 字段映射严格遵循 `[backend/src/generators/protocol-mapping.ts](backend/src/generators/protocol-mapping.ts)` 与 `[docs/protocol-mapping.md](docs/protocol-mapping.md)`,不可瞎猜键名
3. **类型安全**: 后端用 zod schema 校验所有 yaml 输入;前端共享同一 schema(`backend/src/schemas/` ↔ `frontend/src/schemas/`)
4. **个人原型**: 不追求高并发/SSO/计费,够用即可,优先开发速度
5. **改完不重启**: 任何配置变化必须在不重启容器的前提下生效(文件是唯一真相,chokidar invalidate)

## Project Overview

MConvert = 个人自用的 Clash + Surge 订阅转换器 + Web 配置中心。完整设计文档见 `[docs/design.md](docs/design.md)`。

**禁止**: 把它做成"通用 subconverter 替代品"。不支持 quantumult-x / loon / v2rayn 等其它客户端的输出格式;不要为公共服务、多用户、计费做任何让步。

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
│   │   ├── routes/                 # /api/* + /sub
│   │   ├── parsers/                # 节点解析器(clash / surge / v2ray / raw)
│   │   ├── generators/             # clash + surge 输出
│   │   │   ├── clash.ts
│   │   │   ├── surge.ts
│   │   │   └── protocol-mapping.ts # 字段映射表(权威源)
│   │   ├── providers/              # fetch + cron + cache
│   │   ├── chain/                  # chain_rules 应用 + 环检测
│   │   ├── schemas/                # zod schema(全部实体)
│   │   ├── storage/                # YAML 读写 + chokidar
│   │   ├── auth/                   # session + token middleware
│   │   ├── userinfo/               # Subscription-UserInfo 聚合
│   │   └── utils/                  # 工具函数
│   └── tests/
│       ├── parsers/                # 各协议 fixture
│       ├── generators/             # 输入 → 期望 .conf/.yaml fixture
│       └── chain/                  # 链式与环检测
├── frontend/
│   ├── src/
│   │   ├── pages/                  # Login / Dashboard / Providers / Rules / Groups / Modules / Generals / Profiles / Settings / Import
│   │   ├── components/             # ui (shadcn) + 业务组件
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
│   ├── design.md                   # 完整设计(同 plan)
│   ├── protocol-mapping.md         # 字段对照表(权威)
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
- 每个协议有专门 builder 函数(`buildShadowsocksClash` / `buildShadowsocksSurge`),便于测试
- generator 输出必须 deterministic(无时间戳混入主体,只在顶部注释中)

## Testing Strategy

- **单元测试**(vitest): parsers / generators / chain / userinfo / 协议字段映射
- **fixture 对比测试**: `tests/generators/__fixtures__/{profile_name}.yaml.expected`,改动 generator 后用 `pnpm vitest -u` 更新
- **集成测试**: 起一个 Hono 实例,打 `/sub?profile=xxx&t=xxx`,断言响应内容 + header
- **真实客户端验证**(手动): 输出的 conf/yaml 在 Surge / Clash Verge 中至少导入一次,检查无错
- 覆盖率门槛: parsers + generators ≥ 90%,其余模块按需

## Boundaries

### Always

- 所有 yaml 写入前必须 zod schema 校验通过
- 任何修改 generator 前先跑 `pnpm test`,改动后跑 `pnpm vitest -u` 更新 fixture
- 链式代理 chain_rules 应用后必须做环检测
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
- `[backend/src/schemas/profile.ts](backend/src/schemas/profile.ts)` - Profile 是核心实体
- `[backend/src/chain/apply.ts](backend/src/chain/apply.ts)` - 链式代理应用 + 环检测
- `[backend/src/routes/sub.ts](backend/src/routes/sub.ts)` - 订阅入口
- `[frontend/src/pages/profile-editor/](frontend/src/pages/profile-editor)` - Web UI 复杂度峰值
- `[docs/protocol-mapping.md](docs/protocol-mapping.md)` - 与代码 mapping 对照,保持同步

## Common Pitfalls


| 症状                                    | 原因                                   | 修法                                              |
| ------------------------------------- | ------------------------------------ | ----------------------------------------------- |
| Clash 加载报 `unknown field: ws-headers` | 用了 Surge 风格键名                        | 查 protocol-mapping.ts,clash 是 `ws-opts.headers` |
| Surge 节点行被截断                          | 密码含 `,` 或 `"` 没转义                    | 用 surge 节点 builder 中的 `escapeValue`             |
| 链式代理报环                                | A→B→A 配置                             | Web UI 拓扑预览高亮,删除其中一条 chain_rule                 |
| Subscription-UserInfo 显示 0            | Provider fetch 失败回退到旧缓存,但 header 没缓存 | 在 cache JSON 里把 last_userinfo 也存下               |
| 改 yaml 后没生效                           | chokidar 没触发(挂载文件系统问题)               | 重启容器或调 `/api/admin/refresh`                     |
| Hysteria2 obfs 不工作                    | obfs-password 没设(salamander 必填)      | schema 加联动校验                                    |


## When You're Stuck

1. 看 `[docs/protocol-mapping.md](docs/protocol-mapping.md)` 找对应字段名
2. 用真实 Surge / Clash 客户端去 import 输出文件,看报错行号
3. 查 [mihomo wiki](https://wiki.metacubex.one/)
4. 查 [Surge manual](https://manual.nssurge.com/)
5. 写一个最小 fixture 复现问题,加到 `backend/tests/`,再修

## Git Workflow

- 分支: `main`(可发布)、`feat/`*、`fix/*`、`chore/*`
- commit message: 中文短句,前缀 `[模块]`,如 `[generator] 修复 surge ws-headers 多个值导出`
- PR 前必须 `pnpm typecheck && pnpm test` 全绿
- 不要提交 `data/` 真实内容、`.env`、密钥

## User-Specified Content



- 个人原型项目,不追求 100% 单元测试覆盖率,但 generator + parser 模块是核心,必须有 fixture 测试
- 字段映射表(`docs/protocol-mapping.md`)优先级最高,修改前请询问
- Web UI 必须美观现代(shadcn/ui 风格),不能糊弄

