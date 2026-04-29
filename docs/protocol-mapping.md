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
| `up` | `up: "100 Mbps"` | `upload-bandwidth=100`(数字) | [CS] |
| `down` | `down: "200 Mbps"` | `download-bandwidth=200` | [CS] |
| `obfs` | `obfs: salamander` | `obfs=salamander` | [CS] |
| `obfs_password` | `obfs-password:` | `obfs-password=` | [CS] |
| `port_hopping` | `ports: 443-8443` | `port-hopping=443-8443` | [CS],键名不同 |
| `hop_interval` | `hop-interval: 30` | `port-hopping-interval=30` | [CS],键名不同 |

## 7. TUIC v5

| 内部抽象 | Clash | Surge | 备注 |
|---|---|---|---|
| `uuid` | `uuid:` | `uuid=` | [CS] |
| `password` | `password:` | `password=` | [CS] |
| `tuic_version` | `version: 5` | — | [C],Surge 自动识别 v5 |
| `congestion_controller` | `congestion-controller: bbr` | — | [C] |

## 8. WireGuard

| 内部抽象 | Clash | Surge | 备注 |
|---|---|---|---|
| `private_key` | `private-key:` | `private-key=` | [CS] |
| `public_key` | `public-key:` | `public-key=` | [CS] |
| `preshared_key` | `preshared-key:` | `preshared-key=` | [CS] |
| `ip` | `ip:` | `self-ip=` | [CS] |
| `ipv6` | `ipv6:` | `self-ip-v6=` | [CS] |
| `reserved` | `reserved:` | — | [C] |
| `mtu` | `mtu:` | `mtu=` | [CS] |
| `peers` (multi-peer) | `peers:` | — | [C] |

## 9. Snell

| 内部抽象 | Clash | Surge | 备注 |
|---|---|---|---|
| `psk` | — | `psk=` | [S] |
| `snell_version` | — | `version=` | [S] |
| `obfs`, `obfs_host` | — | `obfs=`, `obfs-host=` | [S] |

> Clash 内核不原生支持 Snell;MConvert 在 Clash 输出中跳过 Snell 节点并发出警告。

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
| 远程 URL | `rule-providers:` 段 + `rules: RULE-SET,<id>` | 直接 `RULE-SET,<url>,POLICY` |
| inline | `rules:` 段直接列出 | `[Ruleset Name]` 段 + `RULE-SET,<name>` (Mac 5.3.1+) |
| DOMAIN-SET | `rule-providers behavior: domain` | `DOMAIN-SET,<url>,POLICY` |
| GEOSITE | `GEOSITE,cn,DIRECT` | — (用 ruleset URL 替代) [C] |
| GEOIP | `GEOIP,CN,DIRECT` | `GEOIP,CN,DIRECT` | [CS] |

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

### Surge 输出降级
- Clash `peers:` (WireGuard 多 peer) → 仅取第一个 peer + warning
- Clash `GEOSITE,xxx` → 改为 `DOMAIN-SET,<url>` 若 ruleset 提供了 url,否则 warning
- Clash `mrs` 格式 → 不支持 + warning(由 generator 注释提示)

---

## 维护

修改本文档时,**必须同步**更新 `backend/src/generators/protocol-mapping.ts`,反之亦然。新增协议或字段前请阅读 [AGENTS.md](../AGENTS.md) 中的 Boundaries 一节。
