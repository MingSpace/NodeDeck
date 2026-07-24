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

`chain_rules` 是 Profile 中的顺序数组,**首条匹配命中即生效**:

```yaml
# data/profiles/home.yaml
chain_rules:
  # 规则 1: bbb-airport 机场的所有香港节点都先过 WARP
  - selector:
      from_providers: [bbb-airport]
      include_regex: "港|hk|hong\\s*kong"
    via: WARP-Cloudflare

  # 规则 2: 任何包含"实验性"的节点先过 Front-Relay
  - selector:
      include_regex: "实验性"
    via: Front-Relay
```

`selector` 字段支持:

- `from_providers: [string]` — 限制匹配某些 Provider 的节点
- `include_regex: string` — 节点名匹配此正则 (默认大小写不敏感,直接写 `hk` 就能命中 `HK/Hk/hk`)
- `exclude_regex: string` — 节点名不匹配此正则 (同上)
- `exclude_type: [string]` — 排除某些协议类型(避免给 wireguard 自己加 wireguard 前置)
- `include_region: [string]` — 地区白名单;非空时只匹配已识别出对应 region 的节点(region 未识别的节点视为不匹配)

> include/exclude_regex 走 JS `RegExp(str, "i")`,**不要**写 PCRE 风格的 `(?i)` 前缀 —— JS 不认这种内联标志,会因为 SyntaxError 被静默忽略,导致"正则填了但好像没生效"。

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
| Surge 报"underlying-proxy not found" | 确认 `via` 指向的节点/组名拼写一致(注意空格) |
| Clash 报"dialer-proxy: not found" | 同上 |
| 订阅头出现 `# WARN: Chain cycle detected` | chain_rules 形成了 A→B 又 B→A 的环,环上节点已被自动降级为直连;修正规则消除环即可恢复 |
| 订阅头出现 `# WARN: Chain dangling` | `via` 指向的节点/组不在过滤后的节点池里(被 node_filter 过滤,或该组没加进 profile.proxy_groups) |
| 链式生效但延迟很高 | WARP/前置节点本身慢;考虑用 url-test pool |
