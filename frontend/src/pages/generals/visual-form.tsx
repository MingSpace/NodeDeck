import type { GeneralPresetData } from "./types";
import { BasicSection } from "./sections/basic";
import { DnsSection } from "./sections/dns";
import { MitmSection } from "./sections/mitm";
import { HostsSection, SsidSection, SurgeOnlySection } from "./sections/misc";

interface Props {
  data: GeneralPresetData;
  update: (patch: Partial<GeneralPresetData>) => void;
}

export function GeneralPresetVisualForm({ data, update }: Props) {
  return (
    <div className="space-y-2">
      <CollapsibleSection title="基础" defaultOpen>
        <BasicSection data={data} update={update} />
      </CollapsibleSection>
      <CollapsibleSection title="DNS">
        <DnsSection data={data} update={update} />
      </CollapsibleSection>
      <CollapsibleSection title="MITM (Surge)">
        <MitmSection data={data} update={update} />
      </CollapsibleSection>
      <CollapsibleSection title="Hosts">
        <HostsSection data={data} update={update} />
      </CollapsibleSection>
      <CollapsibleSection title="SSID 规则 (Surge)">
        <SsidSection data={data} update={update} />
      </CollapsibleSection>
      <CollapsibleSection title="Surge 专属选项">
        <SurgeOnlySection data={data} update={update} />
      </CollapsibleSection>
      <div className="text-xs text-muted-foreground border-t pt-2">
        TUN / Sniffer / HTTP API / 其它 Clash 字段请切到「YAML 高级」编辑
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="border rounded-md">
      <summary className="px-3 py-2 cursor-pointer text-sm font-medium bg-muted/30 hover:bg-muted/50">
        {title}
      </summary>
      <div className="p-3 border-t">{children}</div>
    </details>
  );
}
