import { BellRing } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ToggleRow, InfoHint } from "@/components/config-fields";
import type { GeneralPresetData } from "../types";

interface Props {
  data: GeneralPresetData;
  update: (patch: Partial<GeneralPresetData>) => void;
}

const iosBadge = (
  <Badge variant="outline" className="px-1 py-0 text-[9px] font-normal text-muted-foreground">
    iOS
  </Badge>
);

/**
 * Surge iOS 的 VPN Tunnel Scope(manual: General Section → VPN Tunnel Scope)。
 * 默认 iOS 允许 App 绑定物理网卡绕过 Surge VIF,这几个开关把这些流量也拉进隧道。
 *
 * 后三项在 Surge 侧必须配合 include-all-networks 才生效,单开会被静默忽略,
 * 所以后端 general schema 直接拒绝这种组合(TUNNEL_SCOPE_DEPENDENTS)。
 * 这里靠禁用子开关 + 关总开关时连带清空来保证前端不会提交出非法组合。
 */
export function TunnelScopeSection({ data, update }: Props) {
  const all = data.include_all_networks ?? false;

  const setAll = (v: boolean) => {
    if (v) {
      update({ include_all_networks: true });
      return;
    }
    update({
      include_all_networks: undefined,
      include_local_networks: undefined,
      include_apns: undefined,
      include_cellular_services: undefined,
    });
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        仅 Surge iOS 生效 · 决定哪些系统级流量被 Surge 虚拟网卡接管
        <InfoHint>
          默认情况下部分请求不经过 Surge —— App 可以绑定物理网卡绕过 VIF,系统推送链路也走自己的直连通道。
          打开总开关后才能进一步接管局域网、APNs、蜂窝服务这几类流量。
        </InfoHint>
      </div>

      <div className="rounded-lg border bg-amber-500/5 border-amber-500/30 p-2.5">
        <div className="flex items-start gap-2 text-[11px] leading-relaxed">
          <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">收不到 Telegram / X 等境外 App 的推送?</span>{" "}
            iOS 推送走 Apple 的 APNs 独立链路,默认不经过代理。打开下面的
            <code className="mx-1 text-[10px]">include-apns</code>
            让它进入隧道,并给 <code className="text-[10px]">push.apple.com</code> 配一条走代理的规则。
            务必把该规则指向带 fallback 的策略组 —— 节点挂掉时 APNs 要能退回直连,否则国内 App 的推送会一起收不到。
          </span>
        </div>
      </div>

      <ToggleRow
        label="接管所有网络"
        raw="include-all-networks"
        badge={iosBadge}
        description="需 iOS 14.0+;下面三项的前提开关"
        hint="确保所有请求都由 Surge 处理、不发生泄漏(把 Surge 当防火墙时很有用)。可能导致 AirDrop、Xcode 调试、USB 控制台异常,谨慎开启。"
        checked={all}
        onChange={setAll}
      />

      <div className="divide-y rounded-md border">
        <ToggleRow
          label="接管 APNs 推送"
          raw="include-apns"
          badge={iosBadge}
          description="让 Apple 推送流量走隧道,解决境外 App 收不到推送"
          hint="使 Surge 虚拟网卡处理 Apple 推送通知服务(APNs)的网络流量。必须配合「接管所有网络」。"
          checked={data.include_apns ?? false}
          onChange={(v) => update({ include_apns: v || undefined })}
          disabled={!all}
          className="px-2.5"
        />
        <ToggleRow
          label="接管局域网"
          raw="include-local-networks"
          badge={iosBadge}
          description="需 iOS 14.2+"
          hint="使 Surge 虚拟网卡处理发往局域网的请求。同样可能影响 AirDrop 与 USB 调试。必须配合「接管所有网络」。"
          checked={data.include_local_networks ?? false}
          onChange={(v) => update({ include_local_networks: v || undefined })}
          disabled={!all}
          className="px-2.5"
        />
        <ToggleRow
          label="接管蜂窝服务"
          raw="include-cellular-services"
          badge={iosBadge}
          description="VoLTE / Wi-Fi 通话 / IMS / 彩信 / 可视语音留言"
          hint="接管蜂窝服务中可路由到互联网的流量。部分运营商把这类流量直接送进自己的网络而不经互联网,那部分始终被排除在隧道外。必须配合「接管所有网络」。"
          checked={data.include_cellular_services ?? false}
          onChange={(v) => update({ include_cellular_services: v || undefined })}
          disabled={!all}
          className="px-2.5"
        />
      </div>

      {!all && (
        <div className="text-[11px] text-muted-foreground">
          先打开「接管所有网络」才能配置上面三项 —— Surge 会静默忽略单独开启的子项。
        </div>
      )}

      <div className="border-t pt-2 text-[11px] text-muted-foreground">
        改完这几项后需要在 iPhone 上重新加载配置,并开关一次飞行模式才会生效。
      </div>
    </div>
  );
}
