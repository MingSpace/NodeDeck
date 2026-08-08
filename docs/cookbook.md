# NodeDeck 使用手册 (Cookbook)

> 一份"看完就能跑"的最小示例集合。所有 yaml 文件都放在 `data/` 对应子目录,改完即生效。

---

## 目录

1. [混合多机场](#1-混合多机场)
2. [四种规则形态](#2-四种规则形态)
3. [链式代理三段式](#3-链式代理三段式)
4. [Clash proxy-providers 模式](#4-clash-proxy-providers-模式)
5. [Surge 模块嵌入](#5-surge-模块嵌入)
6. [Profile 拼装与订阅 URL](#6-profile-拼装与订阅-url)
7. [嵌套引用其它策略组 (nested_groups)](#7-嵌套引用其它策略组-nested_groups)
8. [Telegram MTProto 入站代理 (Surge)](#8-telegram-mtproto-入站代理-surge)

---

## 1. 混合多机场

每家机场一个 `data/providers/<id>.yaml`:

```yaml
# data/providers/airport-a.yaml
id: airport-a
name: 机场 A
type: http
url: https://airport-a.example.com/api/v1/client/subscribe?token=XXX
user_agent: Surge/2400
parser_hint: auto      # auto / clash / surge / v2ray_base64 / ss_links / mixed / ...
refresh:
  interval: 12h        # never / 4h / 12h / 24h / 1week / on_request
enabled: true
tags: [primary]
clash_proxy_provider:
  enabled: false       # 见第 4 节
```

`refresh.interval` 取值含义:

| 值 | 含义 |
| --- | --- |
| `4h` / `12h` / `24h` / `1week` | 后端 cron 每分钟扫一次,过期才去机场拉 |
| `on_request` | 每次客户端访问 `/sub` 时都同步去机场拉(实时,响应耗时取决于机场) |
| `never` | **手动刷新**:后台 cron 不再自动调度;首次会拉一次种子,之后只有你点列表里的「刷新」/「刷新全部」按钮才会去机场拉(`/sub` 命中现有 cache,不穿透) |

```yaml
# data/providers/airport-b.yaml
id: airport-b
name: 机场 B
type: http
url: https://airport-b.example.com/sub?token=YYY
parser_hint: clash
refresh:
  interval: 24h
enabled: true
tags: [backup]
```

> **首次保存自动拉取**:Web UI 新建一个 `enabled: true` 的 provider 时,后端会立即在后台异步拉取一次,无需手动点刷新。在节点拉到之前,列表会显示黄色「拉取中...」徽标,几秒后自动变为绿色「N 个节点」(成功)或红色「失败」。`enabled: false` 的草稿态以及编辑保存已存在的 provider 都不会触发自动拉取(沿用老的 cron / on_request / 手动刷新行为)。

自建节点 / 手动添加节点请在 Web UI「节点源」页**新建一个 `type: inline` 的「静态节点」类型 Provider**(详见下一节 1.1),写法示例:

```yaml
# data/providers/self-host.yaml
id: self-host
name: 自建节点
type: inline
parser_hint: clash
refresh:
  interval: never
enabled: true
content: |
  proxies:
    - { name: 🏠 Home VPS, type: trojan, server: my.home.vps, port: 443, password: secret, sni: my.home.vps, tls: true, udp: true }
    - { name: 🌐 WARP, type: wireguard, server: engage.cloudflareclient.com, port: 2408, private-key: PRIV, public-key: PUB, ip: 172.16.0.2/32 }
```

> 旧版本曾用 `data/manual-nodes.yaml` 维护手输节点,现已下线 — 改用 inline Provider 后,手动 / 导入节点与机场订阅一样具备启用/禁用/删除等一等公民操作。

**节点名同名怎么办?** 两家机场都叫 "🇭🇰 香港 01" 时,NodeDeck 自动给**所有撞名节点**加来源前缀,如 `【K】🇭🇰 香港 01` / `【A】🇭🇰 香港 01`,一眼看出节点来自哪家。前缀优先取节点源第一个 tag 的完整文本(如给源打了 `主力` tag → `【主力】🇭🇰 香港 01`),没有 tag 时取节点源名称的首字母。不撞名的节点不受影响;撞名但查不到来源(或加前缀后仍同名,如同一机场内重名)时回退追加 ` #2`/` #3` 后缀,保证生成的 yaml/conf 不会因 key 重复加载报错。策略组(group.proxies)中对原名的显式引用会**原位展开为全部同名节点的新名**(组里写了 "🇭🇰 香港 01" → 改名后 `【K】` / `【A】` 两个节点都在组里,不会丢);链式代理 `chain_via` 只能指向单个节点,仍指向第一个同名节点的新名。重命名信息会作为 `# WARN:` 注释附在订阅文件头部。

### 1.1 inline provider — 单节点 / local node list

只想测一两个节点 / 拼盘自建节点,不需要订阅 URL 时,用 `type: inline` 直接把节点文本贴进 `content`:

```yaml
# data/providers/test-node.yaml
id: test-node
name: 测试节点
type: inline
parser_hint: auto
refresh:
  interval: never        # inline 不需要刷新,但写 never 也行
enabled: true
content: |
  🇨🇳 Taiwan 04 = trojan, 8dc9ef6261.example.com, 21409, password=xxx, sni=v.example.com, skip-cert-verify=true, tfo=true, udp-relay=true
```

`content` 支持以下任一格式,`parser_hint: auto` 会自动识别:

| 格式 | 例子 | 说明 |
| --- | --- | --- |
| Clash YAML | `proxies:\n  - {name: A, type: trojan, ...}` | 必须有 `proxies:` 段标头 |
| Surge `[Proxy]` 段 | `[Proxy]\nA = trojan, host, 443, password=pw` | 标准 Surge `.conf` 风格 |
| **裸 Surge 行** | `A = trojan, host, 443, password=pw` | 不要求 `[Proxy]` header,等同 subconverter 的 `set_isolated_items_section("Proxy")` |
| URI 列表 | 一行一个 `ss://` `vmess://` `vless://` `trojan://` `hysteria2://` `tuic://` 等 | |
| v2ray base64 | base64 编码的 URI 列表 | |

**混贴场景**:同时想粘 URI 和 Surge 行,把 `parser_hint` 改成 `mixed`,会按 Sub-Store 风格逐行 try-each-parser:

```yaml
parser_hint: mixed
content: |
  ss://YWVzLTEyOC1nY206cHdk@a.com:8388#A
  HK = trojan, hk.example.com, 443, password=pw
  trojan://pwx@b.com:443?sni=x.com#B
  # 注释行和空行会被自动跳过
```

**保存即重解析**:改完 inline content 在 Web UI 点保存即可,后端会自动 force-refresh 一次(inline 没有"上游"可拉,只有"内容"可重新读;UI 不提供刷新按钮就是这个原因)。http/file 类型的编辑保存仍然不会触发刷新——避免每次编辑都打机场,需要时手动点右上角的刷新按钮或等 cron。

**0 节点怎么排查**:在 Web UI 的 providers 页,展开卡片会看到具体原因(content 为空 / 解析未识别)+ 一键跳转到编辑器修正;后端也会把 cache 状态写成 `error` 而不是装作 `ok`。

**「content 为空(上游返回了空响应)」**:多半是机场按 User-Agent 网关——某些 UA(尤其 Surge 系)返回 HTTP 200 但空 body。节点源的 User-Agent **默认留空即可**,后端拿到空 body 会自动换 `clash-verge` / `mihomo` 等 UA 重试,直到拿到内容;只有全部 UA 都吐空才报错(此时订阅多半已失效,或需要某个特定 UA,可在编辑页手动钉死)。

**机场自带的 host(DNS 防污染)会自动带出——但只带与节点域名相关的**:不少机场在订阅里放了 Clash 顶层 `hosts:` / Surge `[Host]` 段,把节点域名(如 `*.example.com`)指向自家 DoH 以规避污染。只要节点源「节点源 Host」区的 **emit_hosts 开关开着**(默认开),这些 host 会在**每次刷新时自动解析**并随生成的订阅一并带出,无需手动录入。为避免把机场塞的国内域名分流等无关条目也搬进来,只带出**命中本源节点 server 域名**的条目(精确,或通配父域如 `*.example.com` 覆盖 `a.example.com`)。另外有些机场把防污染压在全局 `encrypted-dns-server`(机场自建 DoH)上、`[Host]` 留空,这时会自动**为每个域名型节点推导 `节点域名 = server:<机场DoH>`**,等同于让客户端用机场自己的 DoH 解析节点域名。编辑页该区有只读预览能看到解析到了哪些。手动追加的 host **不受节点域名过滤**,会与自动解析的去重合并。关掉 emit_hosts 则该源的 host(自动 + 手动)都不带出。

### 1.2 自动过滤机场"信息节点"

很多机场会把套餐用量 / 到期日 / 公告 / 官网链接伪装成 trojan / ss 节点塞在订阅顶部,例如:

- `Traffic: 59.17 GB | 150 GB`
- `Expire: 2027-05-02`
- `距离下次重置剩余:25 天`
- `📢 公告:本周维护`
- `官网│https://example.com`
- `https://example.com/dashboard`(整个 name 就是一个 URL)

这些"信息节点"的 `server / port / password` 跟某条真节点**完全一致**,如果不处理:

- 会和真节点共享去重身份(`type|server|port|secret`),被 `dedupeNodes` 的 `keep-first` 策略**把真节点挤掉**,客户端只剩不可用的伪节点
- 节点池数字虚高 1~5 条(对应 Subscription-UserInfo 的字段数);"全部节点"与"按 Provider 分组"两个 Tab 数字对不上

NodeDeck 在 parser 出口默认识别并丢弃这类节点(`backend/src/parsers/info-node-filter.ts`),所有下游消费(主订阅生成 / Profile 预览 / 策略组节点选择 / proxy-providers 子路由 / 节点池 dashboard)**自动拿到干净的节点池,用户无需配置**。

识别算法:`<LEAD> <KEYWORD> <SEPARATOR>`

| 段 | 内容 |
|---|---|
| `LEAD` | 0..N 个装饰字符(emoji / 旗帜 / 空白 / 标点),**不允许出现 ASCII 字母、数字、下划线、汉字** —— 保证关键字位于 name 的语义前缀,避免误伤 `🇯🇵 日本-Traffic-Plus` 这种"关键字出现在中段"的真节点 |
| `KEYWORD` | 中英文关键字:`流量 / Traffic`、`到期 / Expire`、`下次重置 / Reset In`、`公告 / Notice`、`官网 / Website` 等,完整列表见 `info-node-filter.ts` |
| `STRONG_SEP` | `: ：| │ ┃ ∶`,两侧空白可有可无 |
| `WEAK_SEP` | `- = ~ ·` 等,**必须两侧都带空白** —— 否则 `Notice-Premium-01` / `expired-policy-test` 会被误伤 |

另有三条短路规则,命中任一即判为信息节点:① 整个 name 是 `https?://...` 形式;② 以 `t.me/` / `tg://` / `@<handle>` 起首;③ 整行就是纯用量数字(不含任何关键字),如 `45.35 GB | 200 GB`(`PURE_TRAFFIC_REGEX`)。

**不会丢的事**:

- userinfo(流量 / 到期)从 HTTP `Subscription-UserInfo` header 读取,**与节点池无关**,过滤不影响 Dashboard / 订阅响应头
- 自建 inline Provider 的节点同样走 parser,但只要 name 不带 `流量/到期` 这种典型关键字就不会被命中(本来也不应该长这样)

**遇到新形态没被识别怎么办**:把节点 name 加到 `backend/tests/parsers/info-node-filter.test.ts` 的 `POSITIVE_NAMES` 列表(或 `NEGATIVE_NAMES` 反向测试),跑 `pnpm test`,根据 fail case 在 `KEYWORDS` 或 `STRONG_SEP/WEAK_SEP` 里加一条即可。

---

## 2. 四种规则形态

放在 `data/rules/<id>.yaml`,然后由 Profile 的 `rule_modules` 按顺序引用。

### 2.1 远程 RULE-SET (最常见)

```yaml
# data/rules/cn-direct.yaml
id: cn-direct
name: 国内直连
type: remote_url
url: https://ruleset.skk.moe/Clash/non_ip/cn.txt
behavior: classical    # domain / ipcidr / classical
format: text           # yaml / text / mrs
clash_format: rule_provider  # rule_provider / inline
surge_format: rule_set       # rule_set / inline_ruleset / domain_set
update_interval: 86400
surge_flags:
  no_resolve: true
```

→ Clash 输出 `rule-providers:` 段 + `RULE-SET,cn-direct,DIRECT,no-resolve`
→ Surge 输出 `RULE-SET,https://...,DIRECT,no-resolve`

### 2.1a 远程 DOMAIN-SET (Surge 风格的纯域名表)

Surge `[Rule]` 里的 `DOMAIN-SET,<url>,POLICY` 文件每行一个域名,首字母 `.` 表示包含子域名。
mihomo 的 `DomainTrie` 同时支持 `.example.com` 与 `+.example.com` 前缀,所以同一份 list 可以两端共用。

```yaml
# data/rules/cn-domains.yaml
id: cn-domains
name: 国内域名集
type: remote_url
url: https://ruleset.skk.moe/List/domainset/cdn.conf  # 文件每行一个域名,无规则前缀
behavior: domain               # mihomo 用 trie 高效匹配
format: text
clash_format: rule_provider
surge_format: domain_set       # 走 DOMAIN-SET,而非 RULE-SET
update_interval: 86400
```

→ Clash 输出 `rule-providers.cn-domains: { behavior: domain, format: text, ... }` + `RULE-SET,cn-domains,DIRECT`
→ Surge 输出 `DOMAIN-SET,https://...,DIRECT`

> Web UI 一键导入 Surge `.conf` 时,`DOMAIN-SET` 行会被自动识别为这种形态; URL 后缀 `.list/.conf` 会推断为 `format: text`,`.yaml/.yml` 为 `yaml`,`.mrs` 为 `mrs`。

### 2.2 inline payload (自己写规则)

```yaml
# data/rules/my-private.yaml
id: my-private
name: 私有规则
type: inline_list
payload:
  - DOMAIN-SUFFIX,internal.company.com
  - DOMAIN-KEYWORD,intranet
  - IP-CIDR,10.0.0.0/8,no-resolve
  - PROCESS-NAME,Telegram
behavior: classical
clash_format: inline           # 直接展开到 rules: 段
surge_format: inline_ruleset   # 在 conf 中生成 [Ruleset my-private] 段
```

→ Clash 把 `payload` 直接展开到 `rules:` 段。Surge 在 `surge_format: inline_ruleset` 下**不在 `[Rule]` 内联展开**,而是输出一条 `RULE-SET,my-private,<policy>` 引用 + 在文件末尾生成 `[Ruleset my-private]` 段承载规则内容(Mac 5.3.1+ 支持);若把 `surge_format` 设为其它值(如缺省),Surge 端才会把每行直接展开进 `[Rule]`。

### 2.3 GEOSITE (按分类)

```yaml
# data/rules/geosite-google.yaml
id: geosite-google
name: GEOSITE google
type: geosite
geosite_category: google     # 不填则回退到 id (这里是 geosite-google)
# Surge 没有原生 GEOSITE,可选 fallback:
url: https://ruleset.skk.moe/List/domainset/google.conf  # 走 DOMAIN-SET
# 或 payload 写一些 DOMAIN-SUFFIX 行作为内联备选
```

→ Clash: `GEOSITE,google,Proxys`
→ Surge: 优先 `payload` → 其次 `DOMAIN-SET,url` → 都没就 warning

### 2.4 GEOIP

```yaml
# data/rules/geoip-cn.yaml
id: geoip-cn
name: GEOIP CN
type: geoip
geoip_country_code: CN       # 不填则回退到 id
surge_flags:
  no_resolve: true
```

→ 两端都输出 `GEOIP,CN,DIRECT,no-resolve`。

> **小贴士**: 一般不需要单独写 `geoip-cn.yaml`,Profile 的 `rule_modules` 直接用 `{ geoip_cn: true, policy: DIRECT }` 即可,效果一样。

---

## 3. 链式代理三段式

场景: 机场节点(可能被识别) → WARP(住宅 IP 漂白) → 出口 = 实际访问。

### 3.1 准备节点

在「节点源」新建一个 `type: inline` 的「静态节点」Provider,内容里写一个 `WARP` 节点(见第 1 节示例)。

### 3.2 写 chain_rules

Profile 编辑器 →「链式代理」tab 可以可视化配置(拖拽调优先级、实时看命中数),等价 yaml:

```yaml
# data/profiles/home.yaml(节选)
chain_rules:
  - selector:
      include_regex: "^🇭🇰"        # 所有香港节点都套 WARP
      exclude_type: []
      from_providers: []
    via: WARP
    comment: HK 节点统一走 WARP 漂白
  - selector:
      from_providers: [airport-b]   # 机场 B 的所有节点也套 WARP
    via: WARP
```

→ 命中节点会被加上 `chain_via: WARP`,Clash 输出 `dialer-proxy: WARP`,Surge 输出 `underlying-proxy=WARP`。

### 3.3 按策略组 / 点名节点分别挂不同的链

作用范围除了正则和机场,还能直接按**策略组成员**或**点名的节点**圈定,这样"AI 组走 WARP、
流媒体组走日本跳板"就是两条规则的事:

```yaml
chain_rules:
  - comment: AI 组走 WARP 落地
    selector:
      include_groups: [AI]          # 组 name;成员含该组 selector 动态匹配到的节点
    via: WARP

  - comment: 流媒体组走 JP 跳板
    selector:
      include_groups: [Stream]
    via: JP-DIP

  - comment: 另外点名两个节点也走 JP 跳板
    selector:
      include_nodes:                 # 精确名、大小写敏感,写改名后的最终名
        - "【主力】Hong Kong 01"
        - "【主力】Hong Kong 02"
    via: JP-DIP
```

`include_groups` 和 `include_nodes` 之间是"或",跟其它条件(机场/地区/协议/正则)之间是"且"。
候选组只列 `profile.proxy_groups` 已引入的组 —— 没引入的组名在生成时会被判为悬空。

另外两个常用开关:

- `enabled: false` — 临时停用某条规则而不删配置
- `mode: fill` — 只给"还没有 `chain_via`"的节点补前置,机场原文自带 `dialer-proxy` 的节点保持不动
  (默认 `override` 是命中即覆盖)

### 3.4 一个节点只能有一条链

`dialer-proxy` / `underlying-proxy` 都是每节点单值,所以同一节点落在多条规则范围内时**只有最靠前的生效**。
UI 顶部会提示 `N 个节点命中多条规则`,被完全抢走的规则打上「被遮蔽」标记,拖动卡片即可改优先级。

多跳(`A → B → C`)靠"前置自己也挂了链"实现:给 `Landing-A` 写一条 `via: Relay-B`,再给 `Relay-B`
写一条 `via: Relay-C`。UI 底部「解析后的链路」会展开完整路径便于确认。

### 3.5 让落地节点「只能经链式使用」,不出现在选择列表里

落地节点(家宽 / IEPL / 原生 IP 那类)常常不希望被直接选中 —— 直连它要么慢要么容易被风控,
只应该作为链的出口。`hidden_nodes` 干的就是这件事:

```yaml
# data/profiles/home.yaml(节选)
hidden_nodes:
  include_regex: "落地|家宽"       # 也支持 from_providers / include_region / include_type / include_nodes
```

命中的节点:

- **照常写进** Clash `proxies:` / Surge `[Proxy]` —— 所以 `chain_via` 指得到,链式照常工作
- **不再被任何策略组的 selector 动态匹配收纳** —— 地区组、自动测速组里都看不到它们
- **组的 `proxies` 显式点名仍然保留** —— 这是有意的:你专门建一个组把落地节点列进去,
  客户端从那个组选中它 = 走完整的链;而"顺手被自动组捞进来直连"的路被堵掉了

于是典型配置长这样:落地节点写在一个显式组里(`Landing`),链式规则把它挂到中转节点上,
其余自动组只剩中转/普通节点。

```yaml
# data/groups/landing.yaml
proxies: ["JP 落地-01", "JP 落地-02"]   # 显式点名,不受 hidden_nodes 影响
```

选择器语义与链式规则的「作用范围」完全一致(条件之间是"且",正则大小写不敏感),
唯一的差别是:**所有条件留空 = 不隐藏任何节点**(链式规则留空是"匹配全部")。
Profile 编辑器 →「链式代理」tab 顶部有可视化配置区,能实时看到命中了哪些节点。

两个失效场景要留意:

- 开了 `clash_options.use_proxy_providers` 且隐藏节点来自 proxy-provider 机场时,组是靠
  `use: [机场]` 引用的、成员由客户端展开 —— 隐藏挡不住,生成时会给一条 warning
- Surge 组手动开了 `include_all_proxies=true`(或配了 `policy_regex_filter`)时,成员同样由
  客户端从 `[Proxy]` 段展开,隐藏节点会重新出现

### 3.6 优先走落地,落地挂了自动回退直连

最常见的诉求:AI 站点优先走「机场 → 落地」拿固定 IP,落地一挂就退回普通机场节点,不要断网。
关键点是**外层组必须是 `fallback`** —— Surge 的 `fallback` 组按声明顺序取第一个可用的成员,
顺序就是优先级;而 `smart` 组是按实测质量打分选的,链式节点天然多一跳、分数更差,
放进 smart 组等于永远选不中。

```yaml
# data/groups/ai-entry.yaml —— 机场节点池,同时充当「落地的前置」和「落地挂了的兜底」
id: ai-entry
name: AI-机场
type: smart
selector:
  include_regex: "日本|Japan"
  exclude_regex: "Landing"       # 必须排掉落地自己,否则前置成环

# data/groups/ai.yaml —— 对规则暴露的入口
id: ai
name: AI
type: fallback
proxies: ["Landing"]             # 优先级 1:链式落地
nested_groups: ["AI-机场"]        # 优先级 2:兜底直连
interval: 300                    # 不写默认 600 秒才复测,落地挂了最长要等这么久
timeout: 5
```

```yaml
# data/profiles/home.yaml(节选)—— 前置指向**策略组**而不是单个节点,前置本身也能自动故障转移
chain_rules:
  - selector: { include_nodes: ["Landing"] }
    via: AI-机场
```

成员顺序由 `proxies` → `nested_groups` → selector 固定决定(见 `generators/group-members.ts`
的 `resolveGroupMemberEntries`),所以「落地在前、兜底在后」是可控的,不会随机漂移。

两个必须知道的边界:

- `fallback` 只检测「连不连得通」。落地 IP 被目标站风控(返回 403 而不是连接失败)时测试照样通过,
  不会回退 —— 这是协议层面的限制,配置解决不了
- `smart` 组**不能**嵌套其它策略组:Surge 会静默忽略嵌套组与 `DIRECT` 等内置策略。
  Profile 编辑器的「流转」tab 会对这种配置直接给红字提示

配好之后到 Profile 编辑器 →「流转」tab 可以逐层展开确认:规则命中哪个组、组按什么语义选成员、
每个成员的优先级序号、以及链式节点的完整出站路径。

### 3.7 自动校验

- **悬空引用**: 如果 `via: WARP` 但 WARP 节点不在最终节点池里(被 `node_filter` 排除/机场没拉到),自动清空该节点的 chain_via 并 warning,不会让客户端加载报错。
- **环检测**: A→B→A 这种环被发现后,环上节点的 chain_via 都会被清空 + warning。

---

## 4. Clash proxy-providers 模式

让 mihomo 客户端自己去拉每家机场,主订阅文件极小。

### 4.1 启用 provider 的 proxy-provider 输出

```yaml
# data/providers/airport-a.yaml
clash_proxy_provider:
  enabled: true
  health_check_url: http://www.gstatic.com/generate_204
  health_check_interval: 300
```

### 4.2 启用 Profile 的 proxy-providers 模式

```yaml
# data/profiles/home.yaml(节选)
clash_options:
  use_proxy_providers: true
  flag: mihomo
  group_style: flow
```

### 4.3 在 group 里指定哪些 provider 提供节点

```yaml
# data/groups/proxys.yaml
id: Proxys
name: Proxys
type: url-test
proxies: []
nested_groups: []                          # 不嵌套引用其它组,详见第 7 节
selector:
  from_providers: [airport-a, airport-b]   # 这俩机场都用作来源
  exclude_type: []
url: http://cp.cloudflare.com/generate_204
interval: 300
```

→ 主订阅 yaml 里:

```yaml
proxy-providers:
  airport-a:
    type: http
    url: https://your-host/sub/provider/airport-a/clash.yaml?profile=home&t=XXXX
    interval: 43200          # 由该 provider 的 refresh.interval 换算(此处 12h → 43200s;on_request 才是 3600)
    health-check:
      enable: true
      url: http://www.gstatic.com/generate_204
      interval: 300
  airport-b: { ... }

proxy-groups:
  - name: Proxys
    type: url-test
    proxies: []
    use: [airport-a, airport-b]
```

mihomo 启动后会自己去拉两个 provider URL,健康检查独立运行。

> **selector 是动态匹配的,不需要"重新勾选"**
>
> 上面 group 范本里 `proxies: []` 一直留空,`selector.from_providers` 配好两家机场就行。每次客户端拉订阅 (`/sub`) 时,后端都会**实时**从节点池按 `from_providers` / `include_regex` / `exclude_regex` / `exclude_type` 重新过滤,把命中节点写到 yaml。
>
> 这意味着:**机场后续新增节点(或改名/下线),只要符合 selector 条件,下次拉订阅就自动生效,无需到 Web UI 重新勾选**。这跟传统的"先全选 3 个节点保存→机场加到 4 个→回来再勾一次"完全不一样,普通模式下也是同样的动态语义(`use:` 段不存在,但 `proxies:` 段会被 selector 动态展开)。
>
> **`from_providers` 留空 = 全部来源(含未来新增机场)**:`from_providers: []`(或不写)语义就是"不限定来源,所有 Provider 都用作节点来源"。所以**后续新增的机场会自动带进这个组,无需回来勾选**。Web UI 的 from_providers 区把这个状态做成了「全部来源(含未来新增机场)」开关(默认高亮);只有当你想把某个组**收窄到特定机场**时,才点掉它去勾选具体机场。
>
> 只有需要**固定 fallback / url-test 优先顺序**(比如想让香港节点排前面、日本节点排后面)时,才在 Web UI「候选节点与已锁定列表」段点
> <kbd>📌</kbd> 把节点"锁定"到 `proxies` 显式数组里。锁定的节点严格按数组顺序输出,后续新增的同类节点会按节点池顺序追加在锁定段之后。

---

## 5. Surge 模块嵌入

Surge `.sgmodule` 不能"原样 include",但可以把内容拆解到 `data/modules/<id>.yaml`:

```yaml
# data/modules/google-cn.yaml
id: google-cn
name: Google 中国版重写到国际版
content_sections:
  url_rewrite: |
    ^https?://(www.)?(g|google)\.?(cn|com\.hk) https://www.google.com 302
  mitm: |
    hostname = %APPEND% *.google.cn
  rule: |
    DOMAIN-SUFFIX,google.cn,Proxys
```

然后 Profile 的 `surge_modules: [google-cn]` 引用即可。Surge 输出会自动把 `url_rewrite` 段并到 `[URL Rewrite]`、`mitm` 并到 `[MITM]`、`rule` 并到 `[Rule]`。

---

## 6. Profile 拼装与订阅 URL

```yaml
# data/profiles/home.yaml
id: home
name: Home
token: V1StGXR8_Z5j   # 12 字符 nanoid;请用 Web UI 生成,不要复用此示例
providers: [airport-a, airport-b, self-host]   # 含订阅源 + 静态节点源(自建/导入)
node_filter:
  # include/exclude_regex 默认大小写不敏感,直接写 "trial" 就能命中 "TRIAL/Trial/trial",
  # 不需要(也不能)用 PCRE 风格的 `(?i)` 前缀 —— 那是 Go/Python 语法,JS RegExp 不认。
  exclude_regex: "测试|trial|试用"  # 个性化排除;机场"信息节点"(Traffic/Expire/官网...)已由 parser 默认过滤,见 1.2
  exclude_types: [direct]
  rename_rules:
    # rename_rules 走另一条管线,有独立 `flags` 字段,大小写不敏感请加 "i" 到 flags 里:
    - pattern: "\\bIPLC\\b"
      replace: "[IPLC]"
      flags: "gi"
  # 多机场拼接后节点顺序乱(中文"香港"和英文 Hong Kong 分散两头)时打开;
  # 输出节点按地区聚类:HK→TW→JP→SG→US→其他地区字母序→未识别地区垫底,
  # 同地区内保持原始顺序。策略组 selector 动态匹配的成员也会跟着聚类;
  # 组里手动拖拽的显式 proxies 列表顺序不受影响。
  # 地区来自节点名自动识别(emoji/中英文/城市名),也可在节点 yaml 手填 region。
  sort_by_region: true   # 默认 false

chain_rules:
  - selector: { include_regex: "^🇭🇰" }
    via: WARP

proxy_groups: [Proxys, Auto, Manual]

rule_modules:
  - { ref: my-private,    policy: Proxys }
  - { ref: cn-direct,     policy: DIRECT }
  - { ref: geosite-google, policy: Proxys }
  - { geoip_cn: true,     policy: DIRECT }   # 等价于一条 GEOIP,CN,DIRECT,no-resolve
  - { final: Manual,      dns_failed: true } # FINAL,Manual,dns-failed (Surge)

surge_modules: [google-cn]
general_preset: home

userinfo:
  enabled: true         # 默认 false;关闭时下面这些字段不生效,响应头里也不会出现 UserInfo 相关字段
  mode: sum             # primary 模式则用 primary_provider 字段
  expose_per_provider_headers: true

managed_config_url: auto   # auto = 用本服务的 sub URL 自填
managed_config_interval: 86400
managed_config_strict: false

clash_options:
  use_proxy_providers: false
  flag: mihomo
  group_style: flow
```

**订阅 URL**:

```
http://your-vps:8080/sub?profile=home&target=clash&t=V1StGXR8_Z5j
http://your-vps:8080/sub?profile=home&target=surge&t=V1StGXR8_Z5j
```

**响应头** (调试用):

| Header | 说明 |
|---|---|
| `Subscription-UserInfo` | 聚合后的流量信息(upload/download/total/expire),**仅当 `userinfo.enabled: true` 时输出** |
| `X-NodeDeck-Userinfo-<provider_id>` | 每机场原始 header 的透传,**仅当 `userinfo.enabled: true` 且 `expose_per_provider_headers: true`** |
| `Profile-Update-Interval` | 客户端建议的轮询间隔(小时) |
| `Content-Disposition` | `attachment; filename="<profile>.yaml/.conf"` |

输出文件头部的 `# WARN: ...` 注释会列出所有自动降级/重命名/校验事件,便于排查问题。

---

## 7. 嵌套引用其它策略组 (nested_groups)

场景: 主策略组 `Stream` 想引用 `Japan` 这个区域组作为一个 proxy 项(客户端展示成可点开的子选择器,选 Japan → 再选具体 JP 节点),同时还能再放几个独立节点 / `DIRECT` 等内置 policy。

这跟"合并组内所有节点平铺到当前组"是**完全不同**的语义:嵌套引用让用户在客户端能感知到组的层级结构,平铺合并则把层级踩平。NodeDeck 用顶层字段 `nested_groups` 实现嵌套引用,UI 在 ProxyListEditor 快捷区有独立的「嵌套组」chip 行。

### 7.1 yaml 写法

```yaml
# data/groups/japan.yaml
id: Japan
name: Japan
type: url-test
proxies: []
nested_groups: []
selector:
  include_regex: "🇯🇵|JP|日本"
url: http://cp.cloudflare.com/generate_204
interval: 300
```

```yaml
# data/groups/stream.yaml
id: Stream
name: Stream
type: select
proxies: [DIRECT]           # 这里只放节点名 / 内置 policy
nested_groups: [Japan]      # 把 Japan 组作为单个 proxy 项嵌套引用
```

### 7.2 生成结果

Clash 输出:

```yaml
proxy-groups:
  - name: Japan
    type: url-test
    proxies: [🇯🇵 JP-01, 🇯🇵 JP-02, ...]
  - name: Stream
    type: select
    proxies:
      - Japan          # ← 嵌套引用(客户端可点进去再选 Japan 的成员)
      - DIRECT         # ← 同级 proxy 项
```

Surge 输出:

```ini
[Proxy Group]
Japan = url-test, 🇯🇵 JP-01, 🇯🇵 JP-02, ..., url=...
Stream = select, Japan, DIRECT
```

mihomo / Surge 客户端加载后,Stream 的选择面板会显示两行:一个名叫 `Japan` 的"子选择器"(点进去能看到 Japan 组的所有节点) + 一个 `DIRECT` 直连项。

### 7.3 跟其他类似字段的关系

| 字段 | 数据形态 | 语义 |
|---|---|---|
| `g.proxies: string[]` | 节点名 / 内置 policy (DIRECT/REJECT*) | 显式锁定的成员,顺序决定 fallback / url-test 优先级 |
| `g.nested_groups: string[]` | **其它组的 name** | 把其它组作为单个 proxy 项嵌套引用(客户端可点进去) |
| `g.selector` | regex / from_providers / include_region / exclude_type | 动态筛选独立节点(从节点池里"挑出"满足条件的节点加进来) |
| `g.include_other_group: string` | 单个组 name (Surge only) | Surge 原生 `include-other-group` 参数,把那个组的成员**平铺**展开到当前组(跟 nested_groups 的"嵌套引用"语义相反) |

> **老 yaml 自动迁移**: 在旧版本里这事是通过 `selector.include_other_group` 数组实现的(名字误导)。NodeDeck v2 起读取旧 yaml 时,schema transform 会把那个字段的值搬到顶层 `nested_groups`,首次保存后写回的就是新字段形态。无需手动改 yaml。

---

## 8. Telegram MTProto 入站代理 (Surge)

> 需 Surge iOS 5.21.0+ / Mac 6.8.0+。仅 Surge 输出生效,Clash 端忽略。

Surge 可以作为 Telegram 专用的 MTProto 入站代理:Telegram 客户端连到 Surge 的监听端口,DC 选路、出站策略全走 Surge 规则系统。相比 SOCKS5 接管,MTProto 模式避开了 Telegram 客户端的一堆老 bug(IPv6 地址塞进 IPv4 请求、切网后卡 "Updating" 等)。

在 Web UI「Generals → Surge 专属 → MTProto (Telegram 代理)」里开启,或直接写 yaml:

```yaml
# data/general/<id>.yaml 里追加
mtproto:
  enable: true
  interface: 127.0.0.1        # 本机 Telegram 用回环;LAN 设备用局域网地址。generator 原样输出该值(不做改写),iOS 端建议别用 0.0.0.0,填一个具体可达地址
  port: 5753
  secret: 0123456789abcdef0123456789abcdef   # 32 位 hex,可带 dd 前缀;UI 里有"随机"按钮
  ipv6: true                  # 可选:强制走 Telegram IPv6 DC(需出站链路支持 IPv6),可解 IPv4 DC 卡死问题
  # dc_config_url: https://example.com/mtproto-dc-config.json   # 可选:自定义 DC 映射
```

生成的 Surge conf 会多出一段:

```
[MTProto]
interface = 127.0.0.1
port = 5753
secret = 0123456789abcdef0123456789abcdef
ipv6 = true
```

Telegram 客户端填 `服务器 = 可达 interface 的地址 / 端口 = 5753 / secret 同上`,或用链接 `tg://proxy?server=<host>&port=5753&secret=<secret>`。

配套技巧:

- 用 `PROTOCOL,MTProto` 规则(inline ruleset)可以单独给 Telegram 流量指策略;
- secret 不合法(非 32 位 hex)时,生成器会跳过整段并在订阅头部输出 `# WARN:`,不会生成 Surge 拒绝加载的坏配置;
- 一个 profile 只允许一个 `[MTProto]` 段(Surge 限制)。
