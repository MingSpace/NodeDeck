import { describe, expect, it } from "vitest";
import { profileSchema } from "../../src/schemas/profile.js";
import { providerSchema } from "../../src/schemas/provider.js";
import { proxyGroupSchema } from "../../src/schemas/proxy-group.js";
import { rulesetSchema } from "../../src/schemas/ruleset.js";
import { generalPresetSchema } from "../../src/schemas/general-preset.js";

/**
 * Clash 输出移除后,这些只给 Clash 用的字段从 schema 里删掉了。存量 yaml 里还留着它们,
 * 必须照常加载(zod 非 strict object 会 strip 掉),否则用户升级后整份实体校验失败。
 * Repo.save 先 parse 再写回,所以下次保存时残留键会被自动清掉。
 */
describe("存量 yaml 里的 Clash 专属字段被 strip,不影响加载", () => {
  it("profile.clash_options", () => {
    const parsed = profileSchema.parse({
      id: "home",
      name: "Home",
      token: "GOODtoken123",
      clash_options: { use_proxy_providers: true, flag: "stash", group_style: "block" },
    });
    expect(parsed).not.toHaveProperty("clash_options");
  });

  it("provider.clash_proxy_provider", () => {
    const parsed = providerSchema.parse({
      id: "a",
      name: "A",
      type: "http",
      url: "https://example.com/sub",
      clash_proxy_provider: { enabled: true, health_check_url: "http://www.gstatic.com/generate_204", health_check_interval: 300 },
    });
    expect(parsed).not.toHaveProperty("clash_proxy_provider");
  });

  it("proxy-group 的 url / lazy / disable_udp / use / filter / exclude_filter / clash_exclude_type", () => {
    const parsed = proxyGroupSchema.parse({
      id: "Auto",
      name: "Auto",
      type: "url-test",
      proxies: ["HK"],
      url: "http://cp.cloudflare.com/generate_204",
      interval: 300,
      lazy: true,
      disable_udp: true,
      use: ["airport-a"],
      filter: "HK",
      exclude_filter: "AD",
      clash_exclude_type: "ss|http",
    });
    for (const k of ["url", "lazy", "disable_udp", "use", "filter", "exclude_filter", "clash_exclude_type"]) {
      expect(parsed).not.toHaveProperty(k);
    }
    expect(parsed.interval).toBe(300);
  });

  it("ruleset 的 behavior / format / clash_format / geosite_category(type 枚举不变)", () => {
    const parsed = rulesetSchema.parse({
      id: "cn",
      name: "cn",
      type: "geosite",
      behavior: "domain",
      format: "mrs",
      clash_format: "inline",
      geosite_category: "cn",
      surge_format: "domain_set",
      url: "https://example.com/cn.txt",
    });
    for (const k of ["behavior", "format", "clash_format", "geosite_category"]) {
      expect(parsed).not.toHaveProperty(k);
    }
    expect(parsed.type).toBe("geosite");
    expect(parsed.surge_format).toBe("domain_set");
  });

  it("general-preset 的 Clash 键;dns 只留 server / encrypted_server / hijack", () => {
    const parsed = generalPresetSchema.parse({
      id: "g",
      name: "G",
      port: 7890,
      socks_port: 7891,
      mixed_port: 7892,
      allow_lan: true,
      mode: "global",
      log_level: "info",
      find_process_mode: "strict",
      external_controller: "127.0.0.1:9090",
      external_ui: "ui",
      secret: "s",
      global_client_fingerprint: "chrome",
      geodata_mode: true,
      geo_auto_update: true,
      geo_update_interval: 24,
      tun: { enable: true, stack: "gvisor" },
      sniffer: { enable: true },
      dns: {
        enable: true,
        listen: "0.0.0.0:53",
        enhanced_mode: "fake-ip",
        nameserver: ["223.5.5.5"],
        server: ["119.29.29.29"],
        encrypted_server: ["quic://dns.alidns.com"],
        hijack: ["8.8.8.8:53"],
      },
    });
    for (const k of [
      "port", "socks_port", "mixed_port", "allow_lan", "mode", "find_process_mode", "external_controller",
      "external_ui", "secret", "global_client_fingerprint", "geodata_mode", "geo_auto_update",
      "geo_update_interval", "tun", "sniffer",
    ]) {
      expect(parsed).not.toHaveProperty(k);
    }
    expect(parsed.dns).toEqual({
      server: ["119.29.29.29"],
      encrypted_server: ["quic://dns.alidns.com"],
      hijack: ["8.8.8.8:53"],
    });
    // log_level 枚举与默认值不收窄:info 仍合法(生成时映射为 notify)
    expect(parsed.log_level).toBe("info");
  });
});
