import { EntityListPage } from "@/components/entity-list-page";
import { EntityVisualDialog } from "@/components/entity-visual-dialog";
import { GeneralPresetVisualForm } from "./visual-form";
import type { GeneralPresetData } from "./types";

const TEMPLATE: Partial<GeneralPresetData> = {
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
};

export function GeneralsPage() {
  return (
    <EntityListPage<GeneralPresetData>
      title="通用预设 (General Presets)"
      description="General / Host / SSID / DNS / TUN / MITM 配置预设,Profile 引用"
      kind="generals"
      renderRow={(g) => <span className="text-xs">mode={g.mode}</span>}
      template={TEMPLATE}
      renderDialog={({ entity, open, onOpenChange, defaultId }) => (
        <EntityVisualDialog<GeneralPresetData>
          kind="generals"
          entity={entity}
          open={open}
          onOpenChange={onOpenChange}
          defaultId={defaultId}
          templateValue={TEMPLATE}
          maxWidth="sm:max-w-4xl"
          description="可视化编辑常用 General 字段(基础/DNS/MITM/Host/SSID),复杂字段切换 YAML 高级"
          renderForm={(data, update) => <GeneralPresetVisualForm data={data} update={update} />}
        />
      )}
    />
  );
}
