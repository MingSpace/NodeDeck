# 链式代理 (Chain Proxy) 用法

链式代理(也叫多跳/前置代理)允许将一个节点的流量先路由到另一个节点,再由后者转发到目标。常见场景:

- **WARP 前置**: 所有出站都先过 Cloudflare WARP,隐藏真实出口给机场服务端
- **国内跳板**: 公司内网只能走某个 socks5,机场节点都加跳板前置
- **抗 IP 屏蔽**: A 机场被某网站封 IP,加一层 B 机场前置

---

## 客户端语法差异

| 客户端 | 字段名 | 位置 |
|---|---|---|
| Clash (Mihomo v1.18+) | `dialer-proxy: <name>` | `proxies` 内某节点字段 |
| Surge | `underlying-proxy=<name>` | `[Proxy]` 中节点行末参数 |

> 注意: Mihomo v1.19.17 起完全移除了旧 `relay` 类型 group,统一使用 `dialer-proxy`。

---

## NodeDeck 抽象

NodeDeck 用统一字段 `chain_via` 抽象,在生成 Clash / Surge 时翻译为正确的字段名。

`chain_via` 的值可以是:

1. **任意 Provider 中的节点 name** — 例如指向某个 inline (静态节点)Provider 中的 WARP 节点
2. **策略组的 name** — 适合"前置候选池",用 url-test 自动选最快的前置
3. **机场节点的 name** — 也可以指向其他机场的某条节点

---

## 在 Profile 中配置

`chain_rules` 是 Profile 中的顺序数组,**每个节点由第一条命中的规则决定出口**。推荐直接用 Web UI 的
Profile 编辑器 →「链式代理」tab 配置(可拖拽调整优先级、实时看到每条规则命中多少节点),下面是等价的 yaml:

```yaml
# data/profiles/home.yaml
chain_rules:
  # 规则 1: 「AI」策略组里的节点统一走 WARP 落地
  - comment: AI 组走 WARP 落地
    selector:
      include_groups: [AI]
    via: WARP-Cloudflare

  # 规则 2: 点名的两个节点经国内跳板中转
  - comment: 手动指定两个节点走跳板
    selector:
      include_nodes:
        - "【主力】Hong Kong 01"
        - "【主力】Hong Kong 02"
    via: CN-Relay

  # 规则 3: bbb-airport 机场的所有香港节点都先过 WARP(排除 wireguard 自己)
  - selector:
      from_providers: [bbb-airport]
      include_regex: "港|hk|hong\\s*kong"
      exclude_type: [wireguard]
    via: WARP-Cloudflare

  # 规则 4: 机场原文已经带了 dialer-proxy 的节点保持不动,只给其余节点兜底
  - selector: {}
    via: Front-Relay
    mode: fill

  # 临时停用某条规则时不用删,置 enabled: false 即可
  - enabled: false
    selector:
      include_regex: "实验性"
    via: Front-Relay
```

### 规则字段

| 字段 | 默认 | 说明 |
|---|---|---|
| `via` | 必填 | 出口:节点名 / 策略组名 / `DIRECT` |
| `selector` | `{}` | 作用范围,见下表;全空 = 匹配全部节点 |
| `enabled` | `true` | `false` 时该条完全不参与匹配(保留配置便于回滚) |
| `mode` | `override` | `override` = 命中即改写;`fill` = 只给还没有 `chain_via` 的节点补 |
| `comment` | — | 备注,只用于 UI 展示 |

### selector 字段

| 字段 | 说明 |
|---|---|
| `include_groups: [string]` | **按策略组圈定**。存组 **name**;组成员 = 该组的显式 `proxies` + `selector` 动态成员 + `nested_groups` 递归展开 |
| `include_nodes: [string]` | **点名具体节点**。精确匹配、**大小写敏感**(节点名是客户端主键);注意要写改名后的最终名,含 `【标识】` 前缀 |
| `from_providers: [string]` | 限制匹配某些 Provider 的节点;留空 = 不限(含以后新增的机场) |
| `include_type: [string]` | 协议白名单,留空 = 不限 |
| `exclude_type: [string]` | 排除某些协议类型(避免给 wireguard 自己加 wireguard 前置) |
| `include_region: [string]` | 地区白名单;非空时只匹配已识别出对应 region 的节点(region 未识别的节点视为不匹配) |
| `include_regex: string` | 节点名匹配此正则(默认大小写不敏感,直接写 `hk` 就能命中 `HK/Hk/hk`) |
| `exclude_regex: string` | 节点名不匹配此正则(同上) |

### 组合语义

`include_groups` 与 `include_nodes` 之间是 **OR** —— 两者任一非空时构成一个"显式作用域"条件,
节点属于任一指定组、**或者**名字在点名清单里,就算落在范围内。这对应用户视角的
"某个组 **或者** 指定节点走这条链";如果按 AND 处理会变成"既在清单里又在组里",反直觉。

其余条件(`from_providers` / `include_type` / `exclude_type` / `include_region` / 两个正则)彼此以及
与显式作用域之间都是 **AND**。

> include/exclude_regex 走 JS `RegExp(str, "i")`,**不要**写 PCRE 风格的 `(?i)` 前缀 —— JS 不认这种内联标志,会因为 SyntaxError 被静默忽略,导致"正则填了但好像没生效"。
>
> 链式侧对**非法 `include_regex` 判为不匹配**(宁可规则不生效,也不能把整个节点池意外挂到某个前置上);
> 策略组 selector 取相反策略(忽略该条件),因为组成员少了会让客户端报 `proxy not found`。

---

## 一个节点只能有一条链

Clash `dialer-proxy` 与 Surge `underlying-proxy` 都是**每个节点单值**的字段,所以同一个节点在不同策略组里
走不同前置,协议层面表达不出来。NodeDeck 因此采用"首条命中即生效":

- 某节点同时落在规则 #1 和 #3 的范围内 → 只有 #1 生效
- Web UI 的「链式代理」tab 会在顶部提示 `N 个节点命中多条规则`,并给被完全抢走的规则打上「被遮蔽」标记;
  拖动卡片调整顺序即可改变优先级

需要"同一落地节点配两种前置"时,正确做法是在客户端侧建两个策略组分别指向两个**不同的**落地节点,
而不是指望同一节点分裂成两份。

---

## 多跳

单条规则只能表达一跳。`A → B → C` 这样的多跳靠"前置本身也被某条规则挂上了 `chain_via`"自然形成:

```yaml
chain_rules:
  # 落地节点先连 B
  - selector: { include_nodes: ["Landing-A"] }
    via: Relay-B
  # B 自己再连 C
  - selector: { include_nodes: ["Relay-B"] }
    via: Relay-C
```

Web UI 的「链式代理」tab 底部「解析后的链路」会把完整路径展开成 `Landing-A → Relay-B → Relay-C`,
便于确认多跳串对了。

---

## 输出示例

假设 Profile 中有一个来自 inline Provider 的 WARP 节点 `name: WARP-Cloudflare` 和一个 HK 节点 `name: HK-01` 命中了上面规则 1:

### Clash 输出

```yaml
proxies:
  - name: WARP-Cloudflare
    type: wireguard
    server: engage.cloudflareclient.com
    port: 2408
    private-key: ...
    public-key: ...
    ip: 172.16.0.2/32
  - name: HK-01
    type: trojan
    server: gz.example.com
    port: 443
    password: secret
    sni: m.ctrip.com
    dialer-proxy: WARP-Cloudflare    # ← 链式输出
```

### Surge 输出

```ini
[Proxy]
WARP-Cloudflare = wireguard, engage.cloudflareclient.com, 2408, private-key=..., public-key=..., self-ip=172.16.0.2
HK-01 = trojan, gz.example.com, 443, password=secret, sni=m.ctrip.com, underlying-proxy=WARP-Cloudflare
```

---

## 环检测与悬空降级

NodeDeck 在 generator 入口(`validateChain`)对应用完 chain_rules 的节点池做两层校验。**订阅始终能正常生成**,不会因为链式配置问题而报错中断:

1. **悬空引用**: `chain_via` 指向不存在的节点/组 → 清空该字段,节点降级为直接出口 + warning
2. **环**(例如 `A → B → A`)→ 环上所有节点的 `chain_via` 全部清空 + warning

warning 会出现在订阅文件头部的 `# WARN:` 注释和 Web UI 的预览里,例如 `Chain cycle detected: A -> B -> A; chain_via cleared on all involved nodes`。

---

## 链式 + 策略组

如果 `via` 是一个策略组的 name,该组本身可以是 url-test 模式,这样客户端会自动从一组前置节点中选最快的:

```yaml
# 在 groups/ 目录下
- id: WARP-Front-Pool
  name: WARP-Front-Pool
  type: url-test
  proxies: [WARP-Tokyo, WARP-Singapore, WARP-LA]
  url: http://cp.cloudflare.com/generate_204
  interval: 600

# 在 profile 的 chain_rules
chain_rules:
  - selector: { include_regex: "." }
    via: WARP-Front-Pool
```

注意:generator **只输出 `profile.proxy_groups` 已引用的组**,不会因为 `chain_rules.via` 指向了某个组就自动把它写进输出。如果该组没加进 Profile,`chain_via` 会被当作悬空引用清空(+warning)。使用前先到 Profile 编辑器把该组加入 proxy_groups 列表。

---

## 故障排查

| 症状 | 检查 |
|---|---|
| Surge 报"underlying-proxy not found" | 确认 `via` 指向的节点/组名拼写一致(注意空格);UI 里出口会标红为「未找到」 |
| Clash 报"dialer-proxy: not found" | 同上 |
| 规则填了但命中数是 0 | UI 顶部看节点池是否为空;`include_nodes` 要写**改名后**的最终名(含 `【标识】` 前缀);`include_groups` 要写组 **name** 而不是 id |
| 规则命中了但一个都不生效(UI 标「被遮蔽」) | 命中的节点全被更靠前的规则抢走了;拖动卡片把它排到前面 |
| `include_groups` 选不到某个组 | 候选只列 `profile.proxy_groups` 已引入的组 —— 先到「规则 & 策略组」tab 把它加进来 |
| 订阅头出现 `# WARN: Chain cycle detected` | chain_rules 形成了 A→B 又 B→A 的环,环上节点已被自动降级为直连;修正规则消除环即可恢复 |
| 订阅头出现 `# WARN: Chain dangling` | `via` 指向的节点/组不在过滤后的节点池里(被 node_filter 过滤,或该组没加进 profile.proxy_groups) |
| 链式生效但延迟很高 | WARP/前置节点本身慢;考虑用 url-test pool |
