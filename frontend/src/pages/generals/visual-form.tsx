import { useState } from "react";
import { Settings2, Globe, ListTree, Zap, ShieldCheck, TerminalSquare, Send, Wifi, Wrench, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
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
      <CollapsibleSection title="基础" icon={<Settings2 className="h-4 w-4" />} defaultOpen>
        <BasicSection data={data} update={update} />
      </CollapsibleSection>
      <CollapsibleSection title="DNS" icon={<Globe className="h-4 w-4" />}>
        <DnsSection data={data} update={update} />
      </CollapsibleSection>
      <CollapsibleSection title="Hosts" icon={<ListTree className="h-4 w-4" />}>
        <HostsSection data={data} update={update} />
      </CollapsibleSection>
      <CollapsibleSection title="Surge 专属" icon={<Zap className="h-4 w-4" />}>
        <div className="space-y-2">
          <SubCollapsible title="MITM" icon={<ShieldCheck className="h-3.5 w-3.5" />}>
            <MitmSection data={data} update={update} />
          </SubCollapsible>
          <SubCollapsible title="HTTP API (控制台)" icon={<TerminalSquare className="h-3.5 w-3.5" />}>
            <HttpApiSection data={data} update={update} />
          </SubCollapsible>
          <SubCollapsible title="MTProto (Telegram 代理)" icon={<Send className="h-3.5 w-3.5" />}>
            <MtprotoSection data={data} update={update} />
          </SubCollapsible>
          <SubCollapsible title="SSID 规则" icon={<Wifi className="h-3.5 w-3.5" />}>
            <SsidSection data={data} update={update} />
          </SubCollapsible>
          <SubCollapsible title="其他选项" icon={<Wrench className="h-3.5 w-3.5" />}>
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
  icon,
  defaultOpen,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="overflow-hidden rounded-md border"
    >
      <summary className="flex cursor-pointer list-none select-none items-center gap-2 bg-muted/30 px-3 py-2 text-sm font-medium hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <span className="flex-1">{title}</span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </summary>
      <div className="border-t p-3">{children}</div>
    </details>
  );
}

function SubCollapsible({
  title,
  icon,
  defaultOpen,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="overflow-hidden rounded-md border bg-card"
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none select-none items-center gap-2 px-3 py-2 text-xs font-medium transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden",
          open && "border-b bg-muted/20",
        )}
      >
        {icon && (
          <span className={cn("transition-colors", open ? "text-primary" : "text-muted-foreground")}>{icon}</span>
        )}
        <span className="flex-1">{title}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </summary>
      <div className="p-3">{children}</div>
    </details>
  );
}
