# 协议字段对照表

> Clash (Mihomo) ↔ Surge 5 字段命名差异权威表。
> 与代码 `backend/src/generators/protocol-mapping.ts` 保持同步。

---

## 字段标注约定

- **[CS]** = 两端都支持(键名可能不同)
- **[C]** = Clash-only;Surge 端会被忽略 / 降级
- **[S]** = Surge-only;Clash 端会被忽略 / 降级

---

## 1. 通用字段

| 内部抽象 | Clash | Surge | 备注 |
|---|---|---|---|
| `tls` | `tls: bool` | `tls=bool` | [CS] |
| `sni` | `sni:` | `sni=` | [CS] |
| `skip_cert_verify` | `skip-cert-verify: bool` | `skip-cert-verify=bool` | [CS] |
| `fingerprint` | `fingerprint:` | — | [C] |
| `client_fingerprint` | `client-fingerprint:` | `tls-fingerprint=` | [CS] |
| `udp` | `udp: bool` | `udp-relay=bool` | [CS] |
| `tfo` | `tfo: bool` | `tfo=bool` | [CS] |
| `mptcp` | `mptcp: bool` | — | [C] |
| `alpn` | `alpn: [h3]` | `alpn=h3`(可重复) | [CS],写法不同 |

---

## 2. Shadowsocks

| 内部抽象 | Clash | Surge | 备注 |
|---|---|---|---|
| `cipher` | `cipher:` | `encrypt-method=` | [CS] |
| `password` | `password:` | `password=` | [CS] |
| `plugin` | `plugin:` + `plugin-opts:` | `obfs=`, `obfs-host=`, `obfs-uri=` | [CS] |
| 2022 ciphers | `cipher: 2022-blake3-aes-128-gcm` | `encrypt-method=2022-blake3-aes-128-gcm` | 一致 |

## 3. VMess

| 内部抽象 | Clash | Surge | 备注 |
|---|---|---|---|
| `uuid` | `uuid:` | `username=` | [CS],Surge 用 username 字段 |
| `alter_id` | `alterId:` | — | [C],Surge 假定为 0 |
| `cipher` | `cipher:` | `encrypt-method=` | [CS] |
| `vmess_aead` | — | `vmess-aead=bool` | [S] |
| transport ws | `network: ws` + `ws-opts: { path, headers }` | `ws=true, ws-path=, ws-headers=Host:xx\|Foo:bar` | [CS],拍平 |
| transport grpc | `network: grpc` + `grpc-opts:{grpc-service-name}` | — | [C] |

## 4. VLESS

| 内部抽象 | Clash | Surge | 备注 |
|---|---|---|---|
| `uuid` | `uuid:` | `username=` 或 `uuid=` | [CS] |
| `flow` | `flow:` | `vless-flow=` | [CS] |
| `encryption` | `encryption:` | `encryption=` | [CS] |
| Reality public-key | `reality-opts.public-key` | `reality-public-key=` | [CS] |
| Reality short-id | `reality-opts.short-id` | `reality-short-id=` | [CS] |

## 5. Trojan

| 内部抽象 | Clash | Surge | 备注 |
|---|---|---|---|
| `password` | `password:` | `password=` | [CS] |
| transport ws | `network: ws` + `ws-opts:` | `ws=true, ws-path=, ws-headers=` | [CS] |

## 6. Hysteria2

| 内部抽象 | Clash | Surge | 备注 |
|---|---|---|---|
| `password` | `password:` | `password=` | [CS] |
| `up` | `up: "100 Mbps"` | — | [C],Surge 5 hysteria2 不支持 upload-bandwidth |
| `down` | `down: "200 Mbps"` | `download-bandwidth=200` | [CS],Surge 端去掉 `Mbps` 后缀只留数字 |
| `obfs` | `obfs: salamander` | `obfs=salamander` | [CS] |
| `obfs_password` | `obfs-password:` | `obfs-password=` | [CS] |
| `port_hopping` | `ports: 443-8443` | `port-hopping=443-8443` | [CS],键名不同 |
| `hop_interval` | `hop-interval: 30` | `port-hopping-interval=30` | [CS],键名不同 |

> Surge 5 hysteria2 字段参考 [manual.nssurge.com](https://manual.nssurge.com/policy/proxy.html)(iOS 5.8.0+ / Mac 5.4.0+)。

## 7. TUIC v5

| 内部抽象 | Clash | Surge | 备注 |
|---|---|---|---|
| `uuid` | `uuid:` | `uuid=` | [CS],Surge 5 TUIC v5 |
| `password` | `password:` | `password=` | [CS],Surge 5 TUIC v5 |
| `tuic_version` | `version: 5` | `version=5` | [CS],显式标明否则 Surge 退回 v4 (token-only) |
| `congestion_controller` | `congestion-controller: bbr` | — | [C] |

> mihomo wiki 与 Surge 实测均要求 v5 必须给 `uuid + password`,v4 仅给 `token`(本项目当前 schema 仅支持 v5)。

## 8. WireGuard

WireGuard 在两端的**表达结构**完全不同:

- **Clash (mihomo)**: 全部字段在 `proxies:` 单条 yaml 节点里
- **Surge 5**: `[Proxy]` 行只声明 `<name> = wireguard, section-name=<id>`,密钥/self-ip/peer 在独立的 `[WireGuard <id>]` 段里

字段键名映射:

| 内部抽象 | Clash | Surge ([WireGuard X] 段内) | 备注 |
|---|---|---|---|
| `private_key` | `private-key:` | `private-key = ...` | [CS] |
| `public_key` | `public-key:` | 单 peer 内 `peer = (public-key=..., ...)` | [CS],嵌在 peer 括号里 |
| `preshared_key` | `preshared-key:` | 单 peer 内 `peer = (preshared-key=..., ...)` | [CS] |
| `ip` | `ip:` | `self-ip = ...` | [CS] |
| `ipv6` | `ipv6:` | `self-ip-v6 = ...` | [CS] |
| `reserved` | `reserved: AAAA`(base64) | `peer = (..., client-id=83/12/235)`(三字节十进制) | [CS],NodeDeck 不做自动转换 + warning |
| `mtu` | `mtu:` | `mtu = ...` | [CS] |
| `peers` (multi-peer) | `peers: [{...}, {...}]` | 多行 `peer = (public-key=..., endpoint=..., allowed-ips="...")` | [CS] |

参考 [Surge manual: WireGuard](https://manual.nssurge.com/policy/wireguard.html)。

**NodeDeck 实现注意**:

1. `[WireGuard <id>]` 的 `<id>` 要求 ASCII 字母数字 + `-_`,generator 把节点名 emoji/中文/空格剥成 `-`,空了用 `wg-N` 兜底
2. 节点没有 `peers[]` 时,从节点根字段(`server/port/public_key/preshared_key`)合成单 peer,`allowed-ips` 默认 `0.0.0.0/0, ::/0`
3. wireguard 节点不接受 `chain_via` (Surge L3 隧道无法叠 underlying-proxy),命中时发 warning
4. Surge parser 当前只解析 inline 写法的 wireguard,section-name 模式输入会丢密钥(整包导入路径未来可扩展)

## 9. Snell

| 内部抽象 | Clash | Surge | 备注 |
|---|---|---|---|
| `psk` | — | `psk=` | [S] |
| `snell_version` | — | `version=` | [S] |
| `obfs`, `obfs_host` | — | `obfs=`, `obfs-host=` | [S] |

> Clash 内核不原生支持 Snell;NodeDeck 在 Clash 输出中跳过 Snell 节点并发出警告。

---

## 10. 链式代理 (Chain Proxy)

| 内部抽象 | Clash | Surge | 备注 |
|---|---|---|---|
| `chain_via` | `dialer-proxy: <name>` | `underlying-proxy=<name>` | [CS] |

详见 [chain-proxy.md](chain-proxy.md)。

---

## 11. 规则 flags

| 内部抽象 | Clash | Surge | 备注 |
|---|---|---|---|
| `no_resolve` | 行尾 `,no-resolve` | 行尾 `,no-resolve` | [CS] |
| `extended_matching` | — | `,extended-matching` | [S] |
| `pre_matching` | — | `,pre-matching` | [S] |
| `force_remote_dns` | — | `,force-remote-dns` | [S] |
| FINAL `dns_failed` | — | `FINAL,Proxy,dns-failed` | [S] |

## 12. REJECT 子类型

| 内部抽象 | Clash | Surge | 备注 |
|---|---|---|---|
| `REJECT` | `REJECT` | `REJECT` | [CS] |
| `REJECT-DROP` | `REJECT`(降级) | `REJECT-DROP` | [S] |
| `REJECT-NO-DROP` | `REJECT` | `REJECT-NO-DROP` | [S] |
| `REJECT-TINYGIF` | `REJECT` | `REJECT-TINYGIF` | [S] |

带通知参数: `RULE-SET,<url>,REJECT-DROP,'notification-text="..."','notification-interval=1'` (Surge)

## 13. 规则集格式

| 内部抽象 | Clash | Surge |
|---|---|---|
| 远程 URL (`type: remote_url`) | `rule-providers:` 段 + `rules: RULE-SET,<id>`(默认 `clash_format: rule_provider`) | 直接 `RULE-SET,<url>,POLICY`(默认 `surge_format: rule_set`) 或 `DOMAIN-SET,<url>,POLICY`(`surge_format: domain_set`) |
| inline list (`type: inline_list`) | `rules:` 段直接展开每行 | 直接展开;或 `surge_format: inline_ruleset` 时生成 `[Ruleset Name]` 段 + `RULE-SET,<name>` (Mac 5.3.1+) |
| GEOSITE (`type: geosite`) | `GEOSITE,<geosite_category 或 id>,POLICY` | 三级回退:① `payload` 展开内联 → ② `url` 走 `DOMAIN-SET` → ③ warning |
| GEOIP (`type: geoip`) | `GEOIP,<geoip_country_code 或 id>,POLICY` | 同 Clash |
| Surge 内置 (`type: surge_internal`) | LAN → 内联 `DOMAIN-SUFFIX,local` + IP-CIDR;SYSTEM → 跳过 + warning | `RULE-SET,<SYSTEM\|LAN>,POLICY` |

**关键字段**:
- `geosite_category`: GEOSITE 关键字(如 `cn`/`google`/`youtube`)。缺省回退到 `id`,所以可以直接把 ruleset id 命名为 `cn`/`youtube` 等。
- `geoip_country_code`: GEOIP 关键字(如 `CN`/`US`)。缺省回退到 `id`。
- `surge_internal_name`: 仅 `SYSTEM` / `LAN`。Surge 平台共有(参考 [Surge 官方 manual](https://manual.nssurge.com/rule/ruleset.html#internal-ruleset));`LAN` 在 Surge 客户端会触发 DNS 查询,Clash 端 generator 把它展开为内联 IP-CIDR/DOMAIN-SUFFIX。`SYSTEM` 含 USER-AGENT / PROCESS-NAME 规则,Clash 不支持,generator 跳过并 warning。
- `surge_reject_options.type` 在 Surge 端覆盖 `policy`,在 Clash 端会自动降级到合法 `REJECT`(见第 12 节)。
- 分发顺序:**先按 `rs.type` 大类分,再按 `clash_format` / `surge_format` 决定细节**。`type=remote_url` 配 `clash_format=inline` 不被支持,会自动降级为 rule-provider 并 warning。

## 14. 终止规则

| 内部抽象 | Clash | Surge |
|---|---|---|
| 默认匹配 | `MATCH,Proxy` | `FINAL,Proxy` |
| DNS 失败回退 | — | `FINAL,Proxy,dns-failed` [S] |

---

## 15. 降级表(generator 自动处理)

当 Profile 中存在某些目标独有特性,在另一目标输出时按下表降级:

### Clash 输出降级
- Surge `REJECT-DROP/NO-DROP/TINYGIF` → `REJECT`
- Surge `pre-matching/extended-matching/force-remote-dns` flag → 静默丢弃
- Surge `[Module]` 段 → 完全跳过
- Surge `[URL Rewrite]/[Header Rewrite]/[Script]` → 跳过(Clash 无对应)
- Surge `Snell` 节点 → 跳过 + warning
- Surge `RULE-SET,SYSTEM` → 跳过 + warning(含 USER-AGENT/PROCESS-NAME 无 Clash 等价)
- Surge `RULE-SET,LAN` → 展开为内联 DOMAIN-SUFFIX,local + IP-CIDR 列表

### Surge 输出降级
- Clash `peers:` (WireGuard 多 peer) → 仅取第一个 peer + warning
- Clash `GEOSITE,xxx` → 改为 `DOMAIN-SET,<url>` 若 ruleset 提供了 url,否则 warning
- Clash `mrs` 格式 → 不支持 + warning(由 generator 注释提示)

---

## 16. Clash proxy-providers 模式

`profile.clash_options.use_proxy_providers = true` 时启用,把每个 `provider.clash_proxy_provider.enabled = true` 的机场切片为独立 mihomo proxy-provider:

| 主订阅(profile) | proxy-provider 拉取目标 |
|---|---|
| `proxy-providers:` 段列出 N 个机场 | `GET /sub/provider/<id>/clash.yaml?profile=<pid>&t=<token>` |
| `proxies:` 仅含 inline Provider 节点 + 不属于这些机场的节点 | 仅 `proxies:` 段(经过该 profile 的 `node_filter`) |
| `proxy-groups[i].use: [<provider_id>]` | — |

**好处**:主订阅文件更小;客户端可对每机场独立健康检查;一键切换/禁用某机场只动 provider 即可。

**字段**:`provider.clash_proxy_provider`:
```yaml
clash_proxy_provider:
  enabled: true
  health_check_url: http://www.gstatic.com/generate_204
  health_check_interval: 300
```

`group.selector.from_providers` 决定该 group 的 `use:` 引用哪些机场;留空则自动包含所有启用了 proxy-provider 的机场。

---

## 17. 策略组的嵌套引用 vs 平铺合并 (NodeDeck 专属字段)

NodeDeck 在 proxy-group schema 上区分"嵌套引用"与"平铺合并",两端 generator 行为对齐:

| 内部字段 | 数据形态 | 语义 | Clash 输出 | Surge 输出 |
|---|---|---|---|---|
| `g.proxies` | `[node名 / DIRECT / REJECT* / ...]` | 显式锁定的成员;顺序敏感(影响 fallback/url-test 优先级) | 写入 `proxy-groups[i].proxies` 数组前部 | 写入 `[Proxy Group]` 行成员段前部 |
| `g.nested_groups` | `[其它组的 name, ...]` | **嵌套引用**:把其它组作为单个 proxy 项加入,客户端可点开跳到子选择器 | 与节点名同级,直接写入 `proxy-groups[i].proxies` 数组(mihomo 原生支持组名引用) | 与节点名同级,直接写入 `[Proxy Group]` 行成员段(Surge 原生支持组名引用) |
| `g.include_other_group` (string) | `单个其它组 name` | **平铺合并**:把那个组的成员节点展开到当前组(只用于 Surge,Clash 端无原生支持) | 当作组名引用 *单独* 加进 proxies(因为 Clash 没有 include-other-group 参数,降级为嵌套引用) | 作为 `include-other-group=` 参数附加到 [Proxy Group] 行,Surge 客户端按"平铺"语义解析 |
| `g.selector` (object) | regex / from_providers / include_region / exclude_type | **动态筛选**:从节点池里按条件挑独立节点加进来 | 命中节点直接写进 `proxies` 数组(与 g.proxies 同级) | 命中节点直接写进成员段(与 g.proxies 同级) |

**关键区分**:`nested_groups` 与 `include_other_group` 字面上像,语义相反:
- `nested_groups: [Japan]` → 客户端 Stream 面板看到「Japan」一行,点开后切到 Japan 组(层级保留)
- `include_other_group: "Japan"`(Surge)→ 客户端 Stream 面板**直接列出** Japan 的所有节点(层级踩平)

`v1` 历史字段 `selector.include_other_group: string[]` 命名误导,**实际行为是嵌套引用**;`v2` schema transform 自动把它搬到 `nested_groups`,旧 yaml 透明兼容。

---

## 维护

修改本文档时,**必须同步**更新 `backend/src/generators/protocol-mapping.ts`,反之亦然。新增协议或字段前请阅读 [AGENTS.md](../AGENTS.md) 中的 Boundaries 一节。
