import { EntityListPage } from "@/components/entity-list-page";

interface GeneralPreset {
  id: string;
  name: string;
  mode: string;
}

export function GeneralsPage() {
  return (
    <EntityListPage<GeneralPreset>
      title="通用预设 (General Presets)"
      description="General / Host / SSID / DNS / TUN / MITM 配置预设,Profile 引用"
      kind="generals"
      renderRow={(g) => <span className="text-xs">mode={g.mode}</span>}
      template={{
        name: "Home",
        mode: "rule",
        log_level: "notify",
        ipv6: false,
        allow_lan: false,
        proxy_test_url: "http://cp.cloudflare.com/generate_204",
        internet_test_url: "http://wifi.vivo.com.cn/generate_204",
        test_timeout: 5,
        skip_proxy: ["127.0.0.0/8", "192.168.0.0/16", "10.0.0.0/8", "localhost", "*.local"],
        exclude_simple_hostnames: true,
        dns: {
          enable: true,
          server: ["119.29.29.29", "223.5.5.5"],
          hijack: ["8.8.8.8:53"],
        },
        hosts: {},
      } as Partial<GeneralPreset>}
    />
  );
}
