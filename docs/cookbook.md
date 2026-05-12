# MConvert 使用手册 (Cookbook)

> 一份"看完就能跑"的最小示例集合。所有 yaml 文件都放在 `data/` 对应子目录,改完即生效。

---

## 目录

1. [混合多机场](#1-混合多机场)
2. [四种规则形态](#2-四种规则形态)
3. [链式代理三段式](#3-链式代理三段式)
4. [Clash proxy-providers 模式](#4-clash-proxy-providers-模式)
5. [Surge 模块嵌入](#5-surge-模块嵌入)
6. [Profile 拼装与订阅 URL](#6-profile-拼装与订阅-url)

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
| `never` | 第一次拉到后**永久缓存**,即便点"强制刷新"也无效;需重新拉取请临时改成其他选项,等后台拉到再改回 |

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

> 老格式 `{ interval_minutes, on_demand }` 启动时会自动迁移到新 enum(运行时转换,文件不主动重写;在 Web UI 编辑保存后才落新格式)。映射规则:`interval_minutes <= 240 → 4h`、`<= 720 → 12h`、`<= 1440 → 24h`、`> 1440 → 1week`;`on_demand: false` 一律视为 `never`。

> **首次保存自动拉取**:Web UI 新建一个 `enabled: true` 的 provider 时,后端会立即在后台异步拉取一次,无需手动点刷新。在节点拉到之前,列表会显示黄色「拉取中...」徽标,几秒后自动变为绿色「N 个节点」(成功)或红色「失败」。`enabled: false` 的草稿态以及编辑保存已存在的 provider 都不会触发自动拉取(沿用老的 cron / on_request / 手动刷新行为)。

自建节点写 `data/manual-nodes.yaml`:

```yaml
nodes:
  - name: 🏠 Home VPS
    type: trojan
    server: my.home.vps
    port: 443
    password: secret
    sni: my.home.vps
    tls: true
    udp: true
    tags: [self-host]
  - name: 🌐 WARP
    type: wireguard
    server: engage.cloudflareclient.com
    port: 2408
    private_key: PRIV
    public_key: PUB
    ip: 172.16.0.2/32
```

**节点名同名怎么办?** 两家机场都叫 "🇭🇰 香港 01" 时,MConvert 自动给后出现的加 ` #2`/` #3` 后缀,生成的 yaml/conf 不会因 key 重复加载报错。重命名信息会作为 `# WARN:` 注释附在订阅文件头部。

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

MConvert 在 parser 出口默认识别并丢弃这类节点(`backend/src/parsers/info-node-filter.ts`),所有下游消费(主订阅生成 / Profile 预览 / 策略组节点选择 / proxy-providers 子路由 / 节点池 dashboard)**自动拿到干净的节点池,用户无需配置**。

识别算法:`<LEAD> <KEYWORD> <SEPARATOR>`

| 段 | 内容 |
|---|---|
| `LEAD` | 0..N 个装饰字符(emoji / 旗帜 / 空白 / 标点),**不允许出现 ASCII 字母、数字、下划线、汉字** —— 保证关键字位于 name 的语义前缀,避免误伤 `🇯🇵 日本-Traffic-Plus` 这种"关键字出现在中段"的真节点 |
| `KEYWORD` | 中英文关键字:`流量 / Traffic`、`到期 / Expire`、`下次重置 / Reset In`、`公告 / Notice`、`官网 / Website` 等,完整列表见 `info-node-filter.ts` |
| `STRONG_SEP` | `: ：| │ ┃ ∶`,两侧空白可有可无 |
| `WEAK_SEP` | `- = ~ ·` 等,**必须两侧都带空白** —— 否则 `Notice-Premium-01` / `expired-policy-test` 会被误伤 |

另有两条短路规则:整个 name 是 `https?://...` 形式,或以 `t.me/ / tg:// / @<handle>` 起首,也判为信息节点。

**不会丢的事**:

- userinfo(流量 / 到期)从 HTTP `Subscription-UserInfo` header 读取,**与节点池无关**,过滤不影响 Dashboard / 订阅响应头
- 手动节点(`data/manual-nodes.yaml`)由 zod schema 校验,**不走 parser**,不会被这条规则过滤(也不应该,自加的节点不该长这样)

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

→ 两端都会展开成具体规则行;Surge 还会额外生成 `[Ruleset my-private]` 段供未来复用。

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

`data/manual-nodes.yaml` 里有一个 `WARP` 节点(见第 1 节)。

### 3.2 写 chain_rules

```yaml
# data/profiles/home.yaml(节选)
chain_rules:
  - selector:
      include_regex: "^🇭🇰"        # 所有香港节点都套 WARP
      exclude_type: []
      from_providers: []
      include_other_group: []
    via: WARP
    comment: HK 节点统一走 WARP 漂白
  - selector:
      from_providers: [airport-b]   # 机场 B 的所有节点也套 WARP
    via: WARP
```

→ 命中节点会被加上 `chain_via: WARP`,Clash 输出 `dialer-proxy: WARP`,Surge 输出 `underlying-proxy=WARP`。

### 3.3 自动校验

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
selector:
  from_providers: [airport-a, airport-b]   # 这俩机场都用作来源
  include_other_group: []
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
    interval: 3600
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

---

## 5. Surge 模块嵌入

Surge `.sgmodule` 不能"原样 include",但可以把内容拆解到 `data/modules/<id>.yaml`:

```yaml
# data/modules/google-cn.yaml
id: google-cn
name: Google 中国版重写到国际版
enabled_by_default: true
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
providers: [airport-a, airport-b]
include_manual_nodes: true
node_filter:
  exclude_regex: "(?i)(测试|trial|试用)"  # 个性化排除;机场"信息节点"(Traffic/Expire/官网...)已由 parser 默认过滤,见 1.2
  exclude_types: [direct]
  rename_rules:
    - pattern: "(?i)\\bIPLC\\b"
      replace: "[IPLC]"

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
| `X-MConvert-Userinfo-<provider_id>` | 每机场原始 header 的透传,**仅当 `userinfo.enabled: true` 且 `expose_per_provider_headers: true`** |
| `Profile-Update-Interval` | 客户端建议的轮询间隔(小时) |
| `Content-Disposition` | `attachment; filename="<profile>.yaml/.conf"` |

输出文件头部的 `# WARN: ...` 注释会列出所有自动降级/重命名/校验事件,便于排查问题。
