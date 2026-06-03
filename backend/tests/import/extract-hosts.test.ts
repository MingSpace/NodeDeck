import { describe, expect, it } from "vitest";
import { extractHostsFromText } from "../../src/import/extract-hosts.js";

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
*.ovalyraa.com = server:https://doh.example/dns-query
*.ovalyraa.com = server:https://doh2.example/dns-query

[Proxy]
`;
    const res = extractHostsFromText(text);
    expect(res.format).toBe("surge");
    expect(res.hosts["node.example.com"]).toBe("1.2.3.4");
    expect(res.hosts["*.ovalyraa.com"]).toEqual([
      "server:https://doh.example/dns-query",
      "server:https://doh2.example/dns-query",
    ]);
  });

  it("Clash 配置无 hosts: 段时返回 none(sparkcloud 情形)", () => {
    const text = `port: 7890
dns:
  enable: true
proxies:
  - { name: a, type: ss, server: node.sparkcloud.uk, port: 1, cipher: aes-128-gcm, password: p }
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
    const text = `#!MANAGED-CONFIG https://resourcemap.lol/sub?token=x&type=surge interval=43200
[General]
loglevel = notify
ipv6 = true

[Proxy]
🇭🇰 Hong Kong 01 = anytls, 8d4a2926.ovalyraa.com, 15026, password=p, sni=ixigua.com

[Rule]
FINAL,Kuromis,dns-failed

[Host]
*.ovalyraa.com = server:https://hydrogen1693.com:44443/dns-query/abc
*.ovalyraa.com = server:https://subprime7404.com:44443/dns-query/abc
*.ovalyraa.com = server:https://tribunal2944.com/dns-query/abc
`;
    const res = extractHostsFromText(text);
    expect(res.format).toBe("surge");
    expect(res.hosts["*.ovalyraa.com"]).toEqual([
      "server:https://hydrogen1693.com:44443/dns-query/abc",
      "server:https://subprime7404.com:44443/dns-query/abc",
      "server:https://tribunal2944.com/dns-query/abc",
    ]);
  });
});
