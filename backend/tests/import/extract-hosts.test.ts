import { describe, expect, it } from "vitest";
import {
  extractHostsFromText,
  extractEncryptedDnsServers,
  domainKeyMatchesServers,
  filterHostsByNodeDomains,
  deriveProviderHostOverrides,
} from "../../src/import/extract-hosts.js";

describe("extractHostsFromText", () => {
  it("抽取 Clash 顶层 hosts: 段(单值与多值)", () => {
    const text = `port: 7890
proxies:
  - { name: a, type: ss, server: x.com, port: 1, cipher: aes-128-gcm, password: p }
hosts:
  node.example.com: 1.2.3.4
  '*.cdn.example.com':
    - 5.6.7.8
    - 9.10.11.12
`;
    const res = extractHostsFromText(text);
    expect(res.format).toBe("clash");
    expect(res.hosts["node.example.com"]).toBe("1.2.3.4");
    expect(res.hosts["*.cdn.example.com"]).toEqual(["5.6.7.8", "9.10.11.12"]);
  });

  it("抽取 Surge [Host] 段(同域名多行聚合成数组)", () => {
    const text = `[General]
loglevel = notify

[Host]
node.example.com = 1.2.3.4
*.example.com = server:https://doh.example/dns-query
*.example.com = server:https://doh2.example/dns-query

[Proxy]
`;
    const res = extractHostsFromText(text);
    expect(res.format).toBe("surge");
    expect(res.hosts["node.example.com"]).toBe("1.2.3.4");
    expect(res.hosts["*.example.com"]).toEqual([
      "server:https://doh.example/dns-query",
      "server:https://doh2.example/dns-query",
    ]);
  });

  it("Clash 配置无 hosts: 段时返回 none(无 hosts: 段情形)", () => {
    const text = `port: 7890
dns:
  enable: true
proxies:
  - { name: a, type: ss, server: node.example.com, port: 1, cipher: aes-128-gcm, password: p }
`;
    const res = extractHostsFromText(text);
    expect(res.format).toBe("none");
    expect(Object.keys(res.hosts)).toHaveLength(0);
  });

  it("base64 / 空文本返回 none", () => {
    expect(extractHostsFromText("").format).toBe("none");
    expect(extractHostsFromText("c3M6Ly9hYmM=").format).toBe("none");
  });

  it("真实 Surge 订阅(含 #!MANAGED-CONFIG 头 + 多段)正确落到 [Host]", () => {
    const text = `#!MANAGED-CONFIG https://sub.example.com/sub?token=x&type=surge interval=43200
[General]
loglevel = notify
ipv6 = true

[Proxy]
🇭🇰 Hong Kong 01 = anytls, 8d4a2926.example.com, 15026, password=p, sni=ixigua.com

[Rule]
FINAL,Proxy,dns-failed

[Host]
*.example.com = server:https://doh1.example:44443/dns-query/abc
*.example.com = server:https://doh2.example:44443/dns-query/abc
*.example.com = server:https://doh3.example/dns-query/abc
`;
    const res = extractHostsFromText(text);
    expect(res.format).toBe("surge");
    expect(res.hosts["*.example.com"]).toEqual([
      "server:https://doh1.example:44443/dns-query/abc",
      "server:https://doh2.example:44443/dns-query/abc",
      "server:https://doh3.example/dns-query/abc",
    ]);
  });
});

describe("extractEncryptedDnsServers", () => {
  it("抽取 [General] 里逗号分隔的 DoH 列表(https:// 不被注释剥离)", () => {
    const text = `[General]
dns-server = 119.29.29.29, 223.5.5.5
encrypted-dns-server = https://doh1.example.com/dns-query, https://doh2.example.com:44443/dns-query/uuid
[Proxy]
`;
    expect(extractEncryptedDnsServers(text)).toEqual([
      "https://doh1.example.com/dns-query",
      "https://doh2.example.com:44443/dns-query/uuid",
    ]);
  });

  it("无 [General] 段 / 无该键 / 空文本返回空数组", () => {
    expect(extractEncryptedDnsServers("")).toEqual([]);
    expect(extractEncryptedDnsServers("[General]\nloglevel = notify\n[Proxy]\n")).toEqual([]);
    expect(extractEncryptedDnsServers("hosts:\n  a.example.com: 1.2.3.4\n")).toEqual([]);
  });
});

describe("domainKeyMatchesServers", () => {
  const servers = ["a.example.com", "b.example.com"];

  it("精确域名相等才命中", () => {
    expect(domainKeyMatchesServers("a.example.com", servers)).toBe(true);
    expect(domainKeyMatchesServers("c.example.com", servers)).toBe(false);
    expect(domainKeyMatchesServers("a.example.com", ["b.example.com"])).toBe(false);
  });

  it("通配 *./+./.x 命中子域与裸域", () => {
    expect(domainKeyMatchesServers("*.example.com", servers)).toBe(true);
    expect(domainKeyMatchesServers("+.example.com", servers)).toBe(true);
    expect(domainKeyMatchesServers(".example.com", servers)).toBe(true);
    expect(domainKeyMatchesServers("*.example.com", ["example.com"])).toBe(true);
    expect(domainKeyMatchesServers("*.other.com", servers)).toBe(false);
  });

  it("批量绑定 / IP key 一律不命中", () => {
    expect(domainKeyMatchesServers("DOMAIN-SET:https://x/list.txt", servers)).toBe(false);
    expect(domainKeyMatchesServers("RULE-SET:LAN", servers)).toBe(false);
    expect(domainKeyMatchesServers("1.2.3.4", ["1.2.3.4"])).toBe(false);
    expect(domainKeyMatchesServers("::1", ["::1"])).toBe(false);
  });

  it("大小写 / 尾点不敏感", () => {
    expect(domainKeyMatchesServers("A.Example.com.", ["a.example.com"])).toBe(true);
  });
});

describe("filterHostsByNodeDomains", () => {
  it("只保留命中节点域名的条目", () => {
    const hosts = {
      "a.example.com": "1.2.3.4",
      "*.example.com": "server:https://doh.example.com/dns-query",
      "taobao.com": "server:223.6.6.6",
      "*.lan": "server:system",
    };
    expect(filterHostsByNodeDomains(hosts, ["a.example.com"])).toEqual({
      "a.example.com": "1.2.3.4",
      "*.example.com": "server:https://doh.example.com/dns-query",
    });
  });
});

describe("deriveProviderHostOverrides", () => {
  it("① [Host] 全是无关国内域名分流 → 过滤后为空(Flower 风格)", () => {
    const text = `[General]
loglevel = notify
[Host]
taobao.com = server:223.6.6.6
*.qq.com = server:119.28.28.28
*.lan = server:system
[Proxy]
n1 = trojan, a.airport-example.com, 443, password=p, sni=m.example.com
`;
    expect(
      deriveProviderHostOverrides({ text, nodeServerDomains: ["a.airport-example.com"] }),
    ).toEqual({});
  });

  it("② [Host] 为空但有 encrypted-dns-server → 为域名节点推导 server:<DoH>(Nexitally 风格)", () => {
    const text = `[General]
dns-server = 119.29.29.29
encrypted-dns-server = https://doh1.example.com/dns-query, https://doh2.example.com/dns-query
[Host]

[Proxy]
n1 = anytls, srv.example.com, 6660, password=p
`;
    const res = deriveProviderHostOverrides({ text, nodeServerDomains: ["srv.example.com"] });
    expect(res["srv.example.com"]).toEqual([
      "server:https://doh1.example.com/dns-query",
      "server:https://doh2.example.com/dns-query",
    ]);
  });

  it("③ 通配父域 [Host] 命中节点子域则保留,无关条目丢弃", () => {
    const text = `[General]
[Host]
*.example.com = server:https://doh.example.com/dns-query
unrelated.cn = server:223.5.5.5
[Proxy]
`;
    const res = deriveProviderHostOverrides({
      text,
      nodeServerDomains: ["a.example.com", "b.example.com"],
    });
    expect(res["*.example.com"]).toBe("server:https://doh.example.com/dns-query");
    expect(res["unrelated.cn"]).toBeUndefined();
  });

  it("④ 节点全是 IP → 不推导任何 host(无需 DNS 解析)", () => {
    const text = `[General]
encrypted-dns-server = https://doh.example.com/dns-query
[Proxy]
`;
    expect(
      deriveProviderHostOverrides({ text, nodeServerDomains: ["9.9.9.9", "1.1.1.1"] }),
    ).toEqual({});
  });

  it("⑤ [Host] 命中条目与 encrypted-dns 推导合并;单 DoH 时仍是 server: 值数组", () => {
    const text = `[General]
encrypted-dns-server = https://doh.example.com/dns-query
[Host]
a.example.com = 1.2.3.4
unrelated.com = 5.6.7.8
[Proxy]
`;
    const res = deriveProviderHostOverrides({ text, nodeServerDomains: ["a.example.com"] });
    expect(res["a.example.com"]).toEqual([
      "1.2.3.4",
      "server:https://doh.example.com/dns-query",
    ]);
    expect(res["unrelated.com"]).toBeUndefined();
  });

  it("⑥ Clash 顶层 hosts: 同样按节点域名过滤", () => {
    const text = `hosts:
  srv.example.com: 1.2.3.4
  ad.tracker.example: 0.0.0.0
proxies:
  - { name: a, type: ss, server: srv.example.com, port: 1, cipher: aes-128-gcm, password: p }
`;
    const res = deriveProviderHostOverrides({ text, nodeServerDomains: ["srv.example.com"] });
    expect(res["srv.example.com"]).toBe("1.2.3.4");
    expect(res["ad.tracker.example"]).toBeUndefined();
  });
});
