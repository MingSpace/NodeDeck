# 协议字段对照表

> NodeDeck 内部模型 ↔ **Surge** 字段映射权威表,外加 **Clash (mihomo) YAML 输入解析映射**。
> NodeDeck 只生成 Surge 订阅;表里的「Clash YAML 输入键」列是解析机场 Clash YAML 订阅时读的键名(`backend/src/parsers/clash.ts`),**不是输出**。
> **基线 = Surge 当前最新正式版**(iOS 与 Mac),不锁死版本号;个别特性的最低版本要求在对应条目里单独标注。上游标记为 deprecated / legacy / 无效的写法一律按最新版行为处理。
> 与代码 `backend/src/generators/protocol-mapping.ts`(内部字段 ↔ Surge)保持同步。

---

## 字段标注约定

与 `backend/src/schemas/node.ts` 顶部注释一致:

- **[CS]** = Clash YAML 输入能读到、Surge 输出也有(键名可能不同)
- **[in]** = 只来自输入解析(Clash YAML / URI),Surge 无对应:生成时丢弃该字段,或整节点跳过 + warning
- **[S]** = Surge 专属,只从 Surge `.conf` 输入或 Web UI 配置得到

---

## 1. 通用字段

| 内部抽象 | Surge 输出 | Clash YAML 输入键 | 备注 |
|---|---|---|---|
| `tls` | `tls=bool` | `tls: bool` | [CS],Surge 端**仅 vmess** 需要显式 `tls=true`(vmess 默认明文);trojan/https/tuic/hysteria2 等由协议类型隐含,不输出该键 |
| `sni` | `sni=` | `sni:`,vmess/vless 为 `servername:` | [CS],输入两套键都认 —— 见下方说明 |
| `name_cert_verify` | `server-cert-verify-name=` | `name-cert-verify:` | [CS],只改证书 DNSName 校验目标、不改 SNI;Surge 需 iOS 5.21.0+ / Mac 6.8.0+ |
| `ip_version` | `ip-version=dual\|v4-only\|v6-only\|prefer-v4\|prefer-v6` | `ip-version: dual\|ipv4\|ipv6\|ipv4-prefer\|ipv6-prefer` | [CS],**键名同、取值不同**;内部枚举沿用 Clash 输入取值,generator 负责映射 |
| `skip_cert_verify` | `skip-cert-verify=bool` | `skip-cert-verify: bool` | [CS] |
| `fingerprint` | `server-cert-fingerprint-sha256=` | `fingerprint:` | [CS],服务器证书 SHA256 锁定(替代标准 X.509 校验);**区别于** `client_fingerprint` |
| `client_fingerprint` | `tls-fingerprint=` | `client-fingerprint:` | [CS],uTLS 客户端指纹(chrome/firefox 等);**区别于** `fingerprint` |
| `udp` | `udp-relay=bool` | `udp: bool` | [CS] |
| `tfo` | `tfo=bool` | `tfo: bool` | [CS] |
| `mptcp` | — | `mptcp: bool` | [in],Surge 无 per-node mptcp,生成时丢弃 |
| `alpn` | `alpn=h3`(可重复) | `alpn: [h3]` | [CS],写法不同;Surge 端 `alpn=` 需 iOS 5.20.0+ / Mac 6.7.0+ |

### SNI:输入侧两套键名

mihomo 的 TLS 文档([wiki: TLS 配置](https://wiki.metacubex.one/config/proxies/tls/))规定 vmess / vless 的 SNI 键是 `servername`,其余 TLS 系协议(trojan / anytls / tuic / hysteria2)是 `sni`。机场 Clash YAML 里两种写法都会出现,**parser 两套键都认,统一折叠进内部 `sni`**(内部 schema 只有 `sni` 一个字段作为唯一真相);Surge 端一律输出 `sni=`。

---

## 2. Shadowsocks

| 内部抽象 | Surge 输出 | Clash YAML 输入键 | 备注 |
|---|---|---|---|
| `cipher` | `encrypt-method=` | `cipher:` | [CS] |
| `password` | `password=` | `password:` | [CS] |
| `plugin` | `obfs=`, `obfs-host=`, `obfs-uri=` | `plugin:` + `plugin-opts:` | [CS] |
| 2022 ciphers | `encrypt-method=2022-blake3-aes-128-gcm` | `cipher: 2022-blake3-aes-128-gcm` | 一致 |

## 3. VMess

| 内部抽象 | Surge 输出 | Clash YAML 输入键 | 备注 |
|---|---|---|---|
| `uuid` | `username=` | `uuid:` | [CS],Surge 用 username 字段 |
| `alter_id` | — | `alterId:` / `alter-id:` | [in],Surge 假定为 0 |
| `cipher` | `encrypt-method=` | `cipher:` | [CS] |
| `vmess_aead` | `vmess-aead=bool` | — | [S] |
| `tls` | `tls=true` | `tls: bool` | [CS],Surge vmess 默认明文,走 TLS 必须显式输出该参数 |
| transport ws | `ws=true, ws-path=, ws-headers=Host:xx\|Foo:bar` | `network: ws` + `ws-opts: { path, headers }`(兼容旧版平铺 `ws-path` / `ws-headers`) | [CS],Surge 端拍平 |
| transport grpc | — | `network: grpc` + `grpc-opts: { grpc-service-name }` | [in] |

## 4. VLESS —— **[in] 只来自 Clash YAML / URI 输入,Surge 不支持**

Surge 手册的[协议表](https://manual.nssurge.com/policies/overview.html)列出了全部 19 种类型关键字,**没有 `vless`**,也不存在 `vless-flow` / `reality-*` 参数页。想在 Surge 用 VLESS+Reality 只能在本机用 sing-box 之类桥成 socks5。

因此 **Surge generator 对 vless 节点整节点跳过 + warning**(与 `ssr` 同样处理)。parser 仍把下面这些键读进内部模型(节点池、预览里能看到这些节点):

| 内部抽象 | Clash YAML 输入键 | 备注 |
|---|---|---|
| `uuid` | `uuid:` | [in] |
| `flow` | `flow:` | [in],`xtls-rprx-vision` |
| `encryption` | `encryption:` | [in] |
| `sni` | `servername:`(`sni:` 也认) | [in],见第 1 节说明 |
| Reality public-key | `reality-opts.public-key` | [in] |
| Reality short-id | `reality-opts.short-id` | [in] |

## 5. Trojan

| 内部抽象 | Surge 输出 | Clash YAML 输入键 | 备注 |
|---|---|---|---|
| `password` | `password=` | `password:` | [CS] |
| transport ws | `ws=true, ws-path=, ws-headers=` | `network: ws` + `ws-opts:` | [CS] |

## 6. Hysteria2

| 内部抽象 | Surge 输出 | Clash YAML 输入键 | 备注 |
|---|---|---|---|
| `password` | `password=` | `password:` | [CS] |
| `up` | — | `up: "100 Mbps"` | [in],Surge hysteria2 不支持 upload-bandwidth |
| `down` | `download-bandwidth=200` | `down: "200 Mbps"` | [CS],Surge 端去掉 `Mbps` 后缀只留数字 |
| `obfs` | —(由单键隐含) | `obfs: salamander\|gecko` | Surge 无 `obfs=` 键;混淆类型由 `salamander-password=`/`gecko-password=` 隐含,其他类型跳过 + warning |
| `obfs_password` | `salamander-password=` 或 `gecko-password=` | `obfs-password:` | [CS],按 `obfs` 类型选键:salamander(iOS 5.17.0+ / Mac 6.4.3+)/ gecko(iOS 5.20.0+ / Mac 6.7.0+) |
| `port_hopping` | `port-hopping=443-8443` | `ports: 443-8443` | [CS],键名不同 |
| `hop_interval` | `port-hopping-interval=30` | `hop-interval: 30` | [CS],键名不同 |

> Surge hysteria2 字段参考 [manual.nssurge.com](https://manual.nssurge.com/policy/proxy.html)(基础支持 iOS 5.8.0+ / Mac 5.4.0+;Salamander 混淆 iOS 5.17.0+ / Mac 6.4.3+;Gecko 混淆 iOS 5.20.0+ / Mac 6.7.0+)。Clash YAML 输入里 salamander/gecko 均为 `obfs:` + `obfs-password:` 两键([wiki](https://wiki.metacubex.one/config/proxies/hysteria2/));gecko 专属的 `obfs-min/max-packet-size` 不建模。Surge parser 兼容读取旧版 `obfs=`/`obfs-password=` 双键写法。

## 7. TUIC v5

| 内部抽象 | Surge 输出 | Clash YAML 输入键 | 备注 |
|---|---|---|---|
| `uuid` | `uuid=` | `uuid:` | [CS],Surge TUIC v5 |
| `password` | `password=` | `password:` | [CS],Surge TUIC v5 |
| `tuic_version` | `version=5` | `version: 5` | [CS],显式标明否则 Surge 退回 v4 (token-only) |
| `congestion_controller` | — | `congestion-controller: bbr` | [in] |

> Surge 实测要求 v5 必须给 `uuid + password`,v4 仅给 `token`(本项目当前 schema 仅支持 v5)。

## 8. WireGuard

两种格式的**表达结构**完全不同:

- **Surge 输出**: `[Proxy]` 行只声明 `<name> = wireguard, section-name=<id>`,密钥/self-ip/peer 在独立的 `[WireGuard <id>]` 段里
- **Clash YAML 输入**: 全部字段在 `proxies:` 单条 yaml 节点里;parser 只读单 peer 写法(节点根字段),不读 `peers:` 数组

字段键名映射:

| 内部抽象 | Surge 输出([WireGuard X] 段内) | Clash YAML 输入键 | 备注 |
|---|---|---|---|
| `private_key` | `private-key = ...` | `private-key:` | [CS] |
| `public_key` | 单 peer 内 `peer = (public-key=..., ...)` | `public-key:` | [CS],嵌在 peer 括号里 |
| `preshared_key` | 单 peer 内 `peer = (preshared-key=..., ...)` | `preshared-key:` | [CS] |
| `ip` | `self-ip = ...` | `ip:` | [CS] |
| `ipv6` | `self-ip-v6 = ...` | `ipv6:` | [CS] |
| `reserved` | `peer = (..., client-id=83/12/235)`(三字节十进制) | `reserved: AAAA`(base64) | [CS],NodeDeck 不做自动转换 + warning |
| `mtu` | `mtu = ...` | `mtu:` | [CS] |
| `peers` (multi-peer) | 多行 `peer = (public-key=..., endpoint=..., allowed-ips="...")` | —(parser 不读 `peers:`) | 只能经 Web UI / yaml 手填 |

参考 [Surge manual: WireGuard](https://manual.nssurge.com/policy/wireguard.html)。

**NodeDeck 实现注意**:

1. `[WireGuard <id>]` 的 `<id>` 要求 ASCII 字母数字 + `-_`,generator 把节点名 emoji/中文/空格剥成 `-`,空了用 `wg-N` 兜底
2. 节点没有 `peers[]` 时,从节点根字段(`server/port/public_key/preshared_key`)合成单 peer,`allowed-ips` 默认 `0.0.0.0/0, ::/0`
3. wireguard 节点不接受 `chain_via` (Surge L3 隧道无法叠 underlying-proxy),命中时发 warning
4. Surge parser 当前只解析 inline 写法的 wireguard,section-name 模式输入会丢密钥(整包导入路径未来可扩展)

## 9. Snell

Surge 支持 v1–v6;机场 Clash (mihomo) YAML 里的 Snell 节点([wiki: Snell](https://wiki.metacubex.one/config/proxies/snell/),v1–v5)照常解析。

| 内部抽象 | Surge 输出 | Clash YAML 输入键 | 备注 |
|---|---|---|---|
| `psk` | `psk=` | `psk:` | [CS] |
| `snell_version` | `version=` | `version:` | [CS],Surge 1–6;v6 需 iOS 5.20.0+ / Mac 6.7.0+(beta,流量特征由 PSK 派生) |
| `reuse` | `reuse=` | `reuse:` | [CS],连接复用,仅 v4/v5 有意义 |
| `obfs`, `obfs_host` | `obfs=`, `obfs-host=` | `obfs-opts: { mode, host }` | [CS],**写法不同**:Clash 输入嵌套、Surge 平铺 |
| `obfs_uri` | `obfs-uri=` | — | [S],仅 `obfs=http` 有意义 |

> Surge 侧 v1–v3 支持 http/tls,v4/v5 仅 http,v6 不支持 obfs。Clash 输入的 `obfs-opts.mode` 还可能是 `shadow-tls`,parser 归一化到内部 `shadow_tls_*`(见 §9.2)。
> 仅 v3/4/5 支持 UDP。

## 9.1 AnyTLS

| 内部抽象 | Surge 输出 | Clash YAML 输入键 | 备注 |
|---|---|---|---|
| `password` | `password=` | `password:` | [CS],Surge 端 AnyTLS v2 需 iOS 5.17.0+ / Mac 6.4.3+ |
| `reuse` | `reuse=` | — | [S],AnyTLS 规范默认开启复用,`reuse=false` 显式关闭 |

## 9.2 Shadow TLS(传输层混淆,可叠加在任意 TCP 协议上)

Surge 侧统一是任意 proxy 行追加三个平铺参数。Clash (mihomo) YAML 输入按协议分三套写法,parser 全部归一化到内部 `shadow_tls_*` 字段:

| 协议 | Clash YAML 输入写法 | 出处 |
|---|---|---|
| `ss` | `plugin: shadow-tls` + `plugin-opts: { password, host, version }` | [wiki: Shadowsocks](https://wiki.metacubex.one/config/proxies/ss/) |
| `snell` | `obfs-opts: { mode: shadow-tls, host, password, version, alpn }` | [wiki: Snell](https://wiki.metacubex.one/config/proxies/snell/) |
| 其余 TLS 系(vmess/vless/trojan/anytls) | `shadow-tls-opts: { version, password }`,需 `tls: true` | [wiki: TLS 配置](https://wiki.metacubex.one/config/proxies/tls/) |

| 内部抽象 | Surge 输出 | Clash YAML 输入键 | 备注 |
|---|---|---|---|
| `shadow_tls_password` | `shadow-tls-password=` | 三套写法的 `password` | [CS] |
| `shadow_tls_sni` | `shadow-tls-sni=` | ss → `plugin-opts.host`;snell → `obfs-opts.host`;通用写法没有 host 键 | [CS],Surge 不填则不发 SNI |
| `shadow_tls_version` | `shadow-tls-version=`(仅 2/3,缺省 2) | `version`(1/2/3,缺省 2) | v1 在 Surge 端无对应 → 跳过键 + warning |

> Surge:v2 自 iOS 5.2.0 / Mac 4.10.0,v3 自 iOS 5.5.0 / Mac 5.0.3(参考 [manual: Shadow TLS](https://manual.nssurge.com/policy/proxy.html))。

---

## 10. 链式代理 (Chain Proxy)

| 内部抽象 | Surge 输出 | 输入键 | 备注 |
|---|---|---|---|
| `chain_via` | `underlying-proxy=<name>` | Clash YAML `dialer-proxy:` / Surge `underlying-proxy=` | [CS] |

详见 [chain-proxy.md](chain-proxy.md)。

---

## 11. 规则 flags

| 内部抽象 | Surge 输出 | 备注 |
|---|---|---|
| `no_resolve` | 行尾 `,no-resolve` | 仅适用于目标 IP 类规则:`IP-CIDR` / `IP-CIDR6` / `IP-ASN` / `GEOIP`;另可用在 `RULE-SET` / `DOMAIN-SET` 引用行上(强制作用于集合内每条子规则) |
| `extended_matching` | `,extended-matching` | 仅适用于域名类规则:`DOMAIN` / `DOMAIN-SUFFIX` / `DOMAIN-KEYWORD` / `DOMAIN-WILDCARD` / `URL-REGEX`,以及 `RULE-SET` / `DOMAIN-SET` 引用行 |
| `pre_matching` | `,pre-matching` | 策略必须是 REJECT 系;顶层规则专用 |
| `force_remote_dns` | `,force-remote-dns` | |
| FINAL `dns_failed` | `FINAL,Proxy,dns-failed` | |

flags 存在 ruleset 级别,但**落点取决于该 ruleset 的输出形态**:

- 走 `RULE-SET` / `DOMAIN-SET` 引用(`type: remote_url`、`type: surge_internal`,或 `surge_format: inline_ruleset`)时,flags 落在引用行末尾,按 Surge 手册作用于集合内每条子规则
- 内联展开(`type: inline_list` 展开进 `[Rule]`)时,flags **按每行的规则类型分发**:`no-resolve` 只落到 IP 类行,`extended-matching` 只落到域名类行,适用范围未建模的 flag(如 `pre-matching`)一律透传。混合 payload(域名 + IP 混写)因此只需要开一个规则集级别的开关,不必拆成两个 ruleset。实现见 [`generators/rule-line.ts`](../backend/src/generators/rule-line.ts)
- payload 行内自带的 per-line option(ruleset 文件语法允许,如 `IP-CIDR,10.0.0.0/8,no-resolve`)在展开时会被重新排到**策略之后** —— `IP-CIDR,10.0.0.0/8,DIRECT,no-resolve`,否则 option 会占掉策略的位置,客户端把它当成策略名

## 12. REJECT 子类型

`ruleset.surge_reject_options.type` → Surge 策略名(`REJECT_TYPE_MAP`,取值原样):

| 内部抽象 | Surge 输出 |
|---|---|
| `REJECT` | `REJECT` |
| `REJECT-DROP` | `REJECT-DROP` |
| `REJECT-NO-DROP` | `REJECT-NO-DROP` |
| `REJECT-TINYGIF` | `REJECT-TINYGIF` |

带通知参数: `RULE-SET,<url>,REJECT-DROP,'notification-text="..."','notification-interval=1'`

## 13. 规则集格式

| 内部抽象 | Surge 输出 |
|---|---|
| 远程 URL (`type: remote_url`) | 直接 `RULE-SET,<url>,POLICY`(默认 `surge_format: rule_set`) 或 `DOMAIN-SET,<url>,POLICY`(`surge_format: domain_set`) |
| `update_interval` | 行尾 `update-interval=`([manual: Rule Set](https://manual.nssurge.com/rules/ruleset.html));Surge 默认 86400,generator **仅在非默认值时输出**以免产物噪音 |
| inline list (`type: inline_list`) | 直接展开;或 `surge_format: inline_ruleset` 时生成 `[Ruleset Name]` 段 + `RULE-SET,<name>` (Mac 5.3.1+) |
| GEOSITE (`type: geosite`) | Surge 没有原生 GEOSITE,三级回退:① `payload` 展开内联 → ② `url` 走 `DOMAIN-SET` → ③ warning |
| GEOIP (`type: geoip`) | `GEOIP,<geoip_country_code 或 id>,POLICY` |
| Surge 内置 (`type: surge_internal`) | `RULE-SET,<SYSTEM\|LAN>,POLICY` |

**关键字段**:
- `geoip_country_code`: GEOIP 关键字(如 `CN`/`US`)。缺省回退到 `id`。
- `surge_internal_name`: 仅 `SYSTEM` / `LAN`(参考 [Surge 官方 manual](https://manual.nssurge.com/rule/ruleset.html#internal-ruleset));`LAN` 在 Surge 客户端会触发 DNS 查询。
- `surge_reject_options.type` 覆盖 `policy`(见第 12 节)。
- `type: geosite` 保留是为了兼容已有数据;旧 yaml 里的 `geosite_category` / `behavior` / `format` / `clash_format` 读入时被忽略(schema 非 strict,直接 strip)。
- 分发顺序:**先按 `rs.type` 大类分,再按 `surge_format` 决定细节**。

## 14. 终止规则

| 内部抽象 | Surge 输出 |
|---|---|
| 默认匹配 | `FINAL,Proxy` |
| DNS 失败回退 | `FINAL,Proxy,dns-failed` |

---

## 15. Surge 生成时的降级 / 跳过(generator 自动处理)

输入(Clash YAML / URI / Web UI 配置)里有 Surge 表达不了的内容时,按下表处理:

- 来自 Clash YAML / URI 输入的 `vless` 节点 → 整节点跳过 + warning(Surge 无此协议,见 §4)
- 来自 Clash YAML / URI 输入的 `ssr` 节点 → 整节点跳过 + warning(Surge 已不支持 SSR)
- 多 peer WireGuard(`peers[]`) → `[WireGuard <id>]` 段内逐 peer 输出多行 `peer = (...)`,不截断(见 §8)
- `type: geosite` 规则集 → 三级回退:① 有 inline `payload` 则展开内联 → ② 有 `url` 则改为 `DOMAIN-SET,<url>` → ③ 都没有则 warning + 跳过
- `mrs` 格式的远程规则集 URL → 无特殊处理,仍按 `RULE-SET,<url>` 原样输出;Surge 无法解析 mrs 二进制,该 ruleset 需改配文本格式 url
- 同 key 多值 hosts(多 IP / 多 server) → 合并成**一行逗号列表**;`[Host]` 条目自上而下求值、首条命中即止,拆多行会让第二行起永远不生效。多 IP 写 `a.com = 1.2.3.4, 5.6.7.8`,多 DNS 上游写 `a.com = server:8.8.8.8,1.1.1.1`(server: 前缀只出现一次,该写法需 iOS 5.21.0+ / Mac 6.8.0+)

---

## 16. 策略组的嵌套引用 vs 平铺合并 (NodeDeck 专属字段)

NodeDeck 在 proxy-group schema 上区分"嵌套引用"与"平铺合并":

| 内部字段 | 数据形态 | 语义 | Surge 输出 |
|---|---|---|---|
| `g.proxies` | `[node名 / DIRECT / REJECT* / ...]` | 显式锁定的成员;顺序敏感(影响 fallback/url-test 优先级) | 写入 `[Proxy Group]` 行成员段前部 |
| `g.nested_groups` | `[其它组的 name, ...]` | **嵌套引用**:把其它组作为单个 proxy 项加入,客户端可点开跳到子选择器 | 与节点名同级,直接写入 `[Proxy Group]` 行成员段(Surge 原生支持组名引用) |
| `g.include_other_group` (string) | `单个其它组 name` | **平铺合并**:把那个组的成员节点展开到当前组 | 作为 `include-other-group=` 参数附加到 [Proxy Group] 行,Surge 客户端按"平铺"语义解析 |
| `g.selector` (object) | regex / from_providers / include_region / exclude_type | **动态筛选**:从节点池里按条件挑独立节点加进来 | 命中节点直接写进成员段(与 g.proxies 同级) |

**关键区分**:`nested_groups` 与 `include_other_group` 字面上像,语义相反:
- `nested_groups: [Japan]` → 客户端 Stream 面板看到「Japan」一行,点开后切到 Japan 组(层级保留)
- `include_other_group: "Japan"` → 客户端 Stream 面板**直接列出** Japan 的所有节点(层级踩平)

`v1` 历史字段 `selector.include_other_group: string[]` 命名误导,**实际行为是嵌套引用**;`v2` schema transform 自动把它搬到 `nested_groups`,旧 yaml 透明兼容。

### 16.1 策略组测速参数

| 内部字段 | Surge 输出 | 说明 |
|---|---|---|
| `g.interval` | `interval=` | 测试结果有效期(秒);Surge 默认 600 |
| `g.tolerance` | `tolerance=` | 切换阻尼(ms);Surge 默认 100,显式 `0` 会被尊重 |
| `g.timeout` | `timeout=`(秒) | Surge:**按延迟过滤候选**(秒,无默认)—— 实测延迟高于它的成员不参与选择,这**不是**测速自身的超时(那个是 per-policy `test-timeout` 或全局 `test-timeout`,默认 5s) |
| `g.evaluate_before_use` | `evaluate-before-use=` | [S],首次使用时等第一轮测速完成再放行请求 |
| `g.icon_url` | `icon-url=` | 仅展示用;Mac 6.5.0+ |
| `g.policy_priority` | `policy-priority="正则:系数;..."` | [S],Smart 组唯一的调参手段(系数 <1 更优先);值含 `;` 必须整体加引号。iOS 5.11.0+ / Mac 5.7.0+,且 iOS 5.21.0 / Mac 6.8.0 起 0 与负值被拒绝 |

> 组级测速 URL 不建模:Surge 现行版本已把组行上的 `url=` 列为 legacy 且完全无效(不报错,静默忽略),测速 URL 只认 per-policy `test-url` 或 `[General]` 的 `proxy-test-url` / `internet-test-url`。旧 yaml 里的 `url` 读入时被忽略。
>
> Surge 的 `interval` 对 **Smart 组无效**([manual: Smart Group](https://manual.nssurge.com/policy-groups/smart.html)),generator 在 smart 组上不输出该键。
>
> Surge 的 **smart 组会静默忽略成员里的嵌套组与内置策略**([manual: Policy Groups](https://manual.nssurge.com/policy-groups/overview.html) 的 Nesting Groups 小节)——
> 客户端不报错,只是那些成员不参与选择。generator 检测到这种成员时会发 warning。
>
> **`external` 不是策略组类型**。Surge 只有 select / url-test / fallback / load-balance / smart / subnet 六种
> (`ssid` 是 `subnet` 的兼容别名)。`external` 是 `[Proxy]` 段的策略类型且 Mac 独占,写进 `[Proxy Group]`
> 会让 Surge 解析失败;schema 已把存量的 `type: external` 迁移成 `select`,引入外部策略列表请改用 `policy_path`。
>
> **`type: ssid`(subnet 组)目前还不能用**。它的行形状是 `名字 = subnet, default = Proxy, SSID:MyHome = DIRECT`
> ——「条件 = 策略」的键值对而不是成员列表,必须有 `default`。generator 还没有这条分支(`ssid_params` 从未被读取),
> 选了这个类型会输出普通组形状、缺 `default =`,Surge 直接拒绝加载整份配置。需要按网络切策略,当前请用
> `SUBNET` 规则。注意与 `general.ssid_rules`(§18.1,只改设置不选策略)是两个特性。

> Surge 的测速分数取自**两轮 HEAD 请求中的第二轮**(复用已建立的连接),所以它近似"纯请求往返",**不含握手开销**;测试 URL 不支持 keep-alive 时才退化为第一轮全程耗时并给一次性警告。评估链式代理的真实成本时要意识到握手那部分被这个分数隐藏了。参考 [manual: Automatic Testing Group](https://manual.nssurge.com/policy-groups/url-test.html)。

### 16.2 组级链式代理 `underlying_proxy`

| 内部字段 | Surge 输出 | 说明 |
|---|---|---|
| `g.underlying_proxy` | `underlying-proxy=` | [S],组内每个**代理成员**都经该策略出站,等价于给每个成员单独写 `underlying-proxy`,并**覆盖**成员自带的同名参数 |

语义要点(参考 [manual: Common Group Parameters](https://manual.nssurge.com/policy-groups/parameters.html)):

- 覆盖面包括显式成员、`policy-path`、`include-all-proxies`、`include-other-group` 引入的全部成员
- 成员里的**策略组不受影响**(嵌套组可自己声明);`DIRECT` / `REJECT` 等内置策略原样放行
- 被链式的成员在客户端显示为派生策略 `成员名 (via 前置名)`,**带独立的测速结果** —— 这是唯一能同时看到"直连"与"链式"两个延迟的办法
- 不能形成循环引用。NodeDeck 在 `validateGroupRefs` 里只挡**直接自引用**与**悬空引用**(清空该参数 + warning);更深的环依赖 Surge 自己检测,因为成员集合要等客户端展开 `policy-path` / `include-all-proxies` 之后才完整,本地算不准

需要按单个节点精确控制时改用 `profile.chain_rules`(`node.chain_via` 的 `via` 本身就可以填策略组名)。

---

## 17. hosts(域名解析覆盖,generals + provider)

`general.hosts` 与 `provider.hosts` 都是 `Record<string, string | string[]>`(值可为单字符串、逗号分隔字符串或字符串数组),由 `backend/src/generators/hosts.ts` 转成 Surge `[Host]`:

| 写法 | Surge `[Host]` |
|---|---|
| 直接 IP | `domain = 1.2.3.4` |
| 多个 IP / 多上游 | 同 key 合并一行 `domain = v1, v2` |
| 域名别名(CNAME) | `domain = other.com`(**不级联**,见下) |
| 通配符 | `*` / `?`(Surge 语义,原样透传) |
| 指定 DNS `server:` | `domain = server:8.8.8.8`(含 `server:system`/`syslib`) |
| `DOMAIN-SET:` / `RULE-SET:` 批量绑定 | 原样输出 |

**同 key 多值**:value 含逗号或为数组时,Surge `[Host]` **合并成一行逗号列表**(多 IP `a.com = 1.2.3.4, 5.6.7.8`;多 DNS 上游 `a.com = server:8.8.8.8,1.1.1.1`,`server:` 前缀只出现一次)—— **不能拆多行**,`[Host]` 自上而下求值、首条命中即止,拆开后第二行起永远不生效。

**别名不级联**:Surge 的别名(CNAME 式)只重写一次 —— 查找对象换成别名目标后**不会再匹配一遍 `[Host]`**,而是直接交给上游 DNS。所以「`a = b` + `b = 1.2.3.4`」这种两级写法里的第二条永远不生效。真机实测(Surge Mac 6.x,用 RFC 保留的 `.invalid` 域名做对照,报错为 `Empty DNS answer for b from servers: <上游>`),**普通目标域名与代理服务器域名两条路径行为一致**;把 `b` 写在 `a` 之后仍不命中,可排除条目顺序因素。

顺带纠正一处手册与实现的出入:手册 Local DNS Mapping 开头称「proxy server 的 hostname 永远不匹配 `[Host]`,以避免解析循环」,但实测 IP 映射与 `server:` 对节点域名**均生效**(把节点 `server` 写成一个只在 `[Host]` 里有映射的 `.invalid` 域名,可正常连通与测速)。本项目按实测行为设计。

**server: 与 IP/别名混用**:合并多来源 hosts 时同一 key 可能既有别名/IP 又有 `server:` —— 典型是机场 `[Host]` 给节点域名配了别名,而它的 `encrypted-dns-server` 又被 `deriveProviderHostOverrides` 推导成同 key 的 `server:`。一个 `[Host]` 条目只能是一种形态,又因上述「别名不级联」无法拆成两条兼得,故固定**保留 `server:`**、对被丢弃的值发 warning:保留 `server:` 才能让机场自己的 DoH 直接解析原域名、保住抗污染;反过来保别名则会退回全局 `dns-server` 解析节点域名。别名那层间接通常指向同一入口(实测两个域名解析到同一 IP),绕过它不影响连通。

**provider 级 host**:每个 provider 可配 `hosts` + `emit_hosts`(默认 `true`)。`profile-resolver` 用 `mergeHostMaps` 把三类来源去重合并后交给 Surge generator:① `general.hosts`;② 所有启用且 `emit_hosts` 的 provider 手动 `hosts`;③ 这些 provider 刷新时自动解析出的 `cache.extracted_hosts`(仅与节点域名相关的上游 host,来源可以是机场 Clash YAML 的顶层 `hosts:` 或 Surge `[Host]` 段,见 `import/extract-hosts.ts`)。导入 Surge conf 时 `[Host]` 段同一 key 的多行会保留为数组。

**已知限制**:来自 Clash YAML 输入 `hosts:` 的 mihomo 专属语法(`+` / `.` 通配前缀、特殊值 `lan`)不做转换,透传到 Surge 会被当字面域名。

参考:Surge manual [Local DNS Mapping](https://manual.nssurge.com/dns/local-dns-mapping.html);Clash YAML 输入侧的 `hosts:` 语法见 mihomo `docs/config.yaml` hosts 段。

---

## 18. Surge 专属 General 参数 / MTProto

| 内部字段 | Surge 输出 | 备注 |
|---|---|---|
| `general.block_quic` | `[General] block-quic = per-policy\|all-proxy\|all\|always-allow` | [S],全局 QUIC 拦截策略(iOS 5.14.6+ / Mac 5.10.3+) |
| `general.mtproto` | 独立 `[MTProto]` 段(`interface` / `port` / `secret` / `ipv6` / `dc-config-url`) | [S],Telegram MTProto 入站代理(iOS 5.21.0+ / Mac 6.8.0+);secret 必须 32 位 hex(可带 `dd` 前缀),非法时跳过整段 + warning;一个 profile 仅允许一个该段。参考 [manual: MTProto](https://manual.nssurge.com/others/mtproto.html) |
| `general.include_all_networks` | `[General] include-all-networks = true\|false` | [S] **iOS 独占**(iOS 14.0+),Mac 忽略。默认 iOS 允许 App 绑定物理网卡绕过 Surge VIF,开启后所有请求都由 Surge 处理、不发生泄漏。可能导致 AirDrop / Xcode 调试 / USB 控制台异常。下面三项的前提 |
| `general.include_local_networks` | `[General] include-local-networks = true\|false` | [S] iOS 独占(iOS 14.2+),接管发往局域网的请求。**必须配合 `include-all-networks = true`** |
| `general.include_apns` | `[General] include-apns = true\|false` | [S] iOS 独占,让 Surge VIF 接管 Apple 推送通知服务(APNs)流量。**必须配合 `include-all-networks = true`**。大陆网络下 APNs 直连链路受干扰时,Telegram / X 等境外 App 收不到推送,需本开关 + 一条把 `push.apple.com` 指向代理的规则;该规则务必指向带 fallback 的策略组,否则节点故障时国内 App 推送会一起失效 |
| `general.include_cellular_services` | `[General] include-cellular-services = true\|false` | [S] iOS 独占,接管蜂窝服务(VoLTE / Wi-Fi 通话 / IMS / 彩信 / 可视语音留言)中可路由到互联网的流量;运营商直连自家网络的那部分始终排除在隧道外。**必须配合 `include-all-networks = true`** |

后三项的依赖关系由 `schemas/general-preset.ts` 的 `TUNNEL_SCOPE_DEPENDENTS` 在 schema 层强制(单开子项 = 保存失败),因为 Surge 侧是**静默忽略**,生成一份看着有效实际无效的 conf 比报错更难排查。导入 Surge conf 时遇到这种组合会按 Surge 的实际生效结果剔除子项 + warning,避免整包导入失败。参考 [manual: VPN Tunnel Scope](https://manual.nssurge.com/profile/general.html)。

### 18.1 Subnet Settings(产物段名 `[SSID Setting]`)

`general.ssid_rules`([S] 专属):**在匹配的网络下套用一组设置**。官方文档已改称 Subnet Settings,配置里的段名为兼容历史仍是 `[SSID Setting]`。

**它不选策略** —— 这是最容易混淆的一点。"按当前网络自动切策略"是 `[Proxy Group]` 里的 **subnet 组**(`名字 = subnet, default = Proxy, SSID:MyHome = DIRECT`,`ssid` 是其兼容别名)或 `SUBNET` 规则,和本段是两个特性,只共用同一套 subnet 表达式语法。NodeDeck 历史上给本段输出过 `policy=`,但手册里本段从来没有该参数,已移除:老 yaml 里的 `policy` 在 schema parse 阶段丢弃,导入 `.conf` 遇到 `policy=` 给 warning。

行的形状是 `<subnet 表达式> key=value,key=value` —— **参数之间是逗号,不是空格**;表达式含空格时整个表达式要用双引号包住(`"SSID:My Home" tfo-behaviour=force-enabled`)。

| 内部字段 | Surge 输出 | 备注 |
|---|---|---|
| `match` | 行首的 subnet 表达式 | `SSID:`(Wi-Fi 名,支持 `*` `?` 通配,大小写敏感)/ `BSSID:`(AP MAC)/ `ROUTER:`(网关 IP)/ `TYPE:WIFI\|WIRED\|CELLULAR` / `MCCMNC:`(运营商,iOS 独占;iOS 16.4 起系统不再给 MCC/MNC,可能失效)。带前缀的形式需 iOS 4.12.0+ / Mac 4.5.0+;无前缀的裸值是 legacy 写法,按 SSID / BSSID / 网关 IP 依次比对 |
| `suspend` | `suspend=` | 该网络下临时挂起 Surge。**只在切换网络时触发** —— 已连着该网络再手动启动 Surge 不会被挂起 |
| `cellular_fallback` | `cellular-fallback=` | iOS 独占,`default\|off\|wifi-assist\|hybrid`,覆盖该网络的 Wi-Fi 助理 / 混合网络行为 |
| `cellular_mode` | `cellular-mode=` | Mac 独占,把该网络当计费网络(Metered Network Mode,只放行允许列表里的应用) |
| `tfo_behaviour` | `tfo-behaviour=` | `auto\|force-enabled\|force-disabled`(iOS 4.12.0+ / Mac 4.5.0+)。`force-enabled` 会忽略系统黑洞检测,该网络实际不支持 TFO 时代理会完全连不上 |
| `dns_server` | `dns-server=a,b` | 该网络的 DNS 上游,元素为 IP 或 `system` |
| `encrypted_dns_server` | `encrypted-dns-server=a,b` | 该网络的加密 DNS URL;全局配了加密 DNS 又想退回传统 DNS 必须显式写 `off` |

两个列表型参数(`dns-server` / `encrypted-dns-server`)的多值也用逗号,与参数分隔符同形,靠"token 里有没有 `=`"区分归属 —— 所以 generator 把它们排在一行的最后。表达式为空或一行没有任何生效参数时跳过该行 + warning(裸表达式在 Surge 里是空操作)。

参考:[manual: Subnet Settings](https://manual.nssurge.com/features/subnet-settings.html)、[manual: Subnet Expressions](https://manual.nssurge.com/rules/protocol-and-network.html)、[manual: Subnet Group](https://manual.nssurge.com/policy-groups/subnet.html)。

---

## 维护

修改本文档时,**必须同步**更新 `backend/src/generators/protocol-mapping.ts`(内部字段 ↔ Surge),反之亦然;「Clash YAML 输入键」列与 `backend/src/parsers/clash.ts` 对照。新增协议或字段前请阅读 [AGENTS.md](../AGENTS.md) 中的 Boundaries 一节。
