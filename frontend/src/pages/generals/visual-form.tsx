import type { GeneralPresetData } from "./types";
import { BasicSection } from "./sections/basic";
import { DnsSection } from "./sections/dns";
import { MitmSection } from "./sections/mitm";
import { MtprotoSection } from "./sections/mtproto";
import { HostsSection, HttpApiSection, SsidSection, SurgeOnlySection } from "./sections/misc";

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
      <CollapsibleSection title="Hosts">
        <HostsSection data={data} update={update} />
      </CollapsibleSection>
      <CollapsibleSection title="Surge 专属">
        <div className="space-y-2">
          <SubCollapsible title="MITM" defaultOpen>
            <MitmSection data={data} update={update} />
          </SubCollapsible>
          <SubCollapsible title="HTTP API (控制台)" defaultOpen>
            <HttpApiSection data={data} update={update} />
          </SubCollapsible>
          <SubCollapsible title="MTProto (Telegram 代理)" defaultOpen>
            <MtprotoSection data={data} update={update} />
          </SubCollapsible>
          <SubCollapsible title="SSID 规则" defaultOpen>
            <SsidSection data={data} update={update} />
          </SubCollapsible>
          <SubCollapsible title="其他选项" defaultOpen>
            <SurgeOnlySection data={data} update={update} />
          </SubCollapsible>
        </div>
      </CollapsibleSection>
      <div className="text-xs text-muted-foreground border-t pt-2">
        TUN / Sniffer / 其它 Clash 高阶字段请切到「YAML 高级」编辑
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

function SubCollapsible({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="border-l-2 border-muted pl-3">
      <summary className="py-1.5 cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
        {title}
      </summary>
      <div className="pt-2 pb-1">{children}</div>
    </details>
  );
}
