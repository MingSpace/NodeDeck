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
parser_hint: auto      # auto / clash / surge / v2ray_base64 / ss_links / ...
refresh:
  interval_minutes: 60 # 每小时拉一次
  on_demand: true
enabled: true
tags: [primary]
clash_proxy_provider:
  enabled: false       # 见第 4 节
```

```yaml
# data/providers/airport-b.yaml
id: airport-b
name: 机场 B
type: http
url: https://airport-b.example.com/sub?token=YYY
parser_hint: clash
refresh:
  interval_minutes: 240
enabled: true
tags: [backup]
```

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
  exclude_regex: "(?i)(剩余流量|官网|过期)"  # 排除标题节点
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
| `Subscription-UserInfo` | 聚合后的流量信息(upload/download/total/expire) |
| `X-MConvert-Userinfo-<provider_id>` | 每机场原始 header 的透传 |
| `Profile-Update-Interval` | 客户端建议的轮询间隔(小时) |
| `Content-Disposition` | `attachment; filename="<profile>.yaml/.conf"` |

输出文件头部的 `# WARN: ...` 注释会列出所有自动降级/重命名/校验事件,便于排查问题。
