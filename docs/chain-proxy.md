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
| Surge 5 | `underlying-proxy=<name>` | `[Proxy]` 中节点行末参数 |

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

## 环检测

NodeDeck 在生成前会构建链式拓扑图。如果存在环(例如 `A → B → A`),会:

1. 拒绝生成订阅
2. Web UI 中高亮报错
3. 后台日志记录环路径

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

输出时,该策略组也会被自动写入 `[Proxy Group]` (Surge) 或 `proxy-groups:` (Clash) 段。

---

## 故障排查

| 症状 | 检查 |
|---|---|
| Surge 报"underlying-proxy not found" | 确认 `via` 指向的节点/组名拼写一致(注意空格) |
| Clash 报"dialer-proxy: not found" | 同上 |
| NodeDeck 报"chain proxy cycle detected" | 检查 chain_rules 是否有 A→B 又 B→A |
| 链式生效但延迟很高 | WARP/前置节点本身慢;考虑用 url-test pool |
