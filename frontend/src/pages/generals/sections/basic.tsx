import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LabeledField, ToggleRow } from "@/components/config-fields";
import type { GeneralPresetData } from "../types";

interface Props {
  data: GeneralPresetData;
  update: (patch: Partial<GeneralPresetData>) => void;
}

export function BasicSection({ data, update }: Props) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <LabeledField label="ID (文件名)">
          <Input value={data.id} onChange={(e) => update({ id: e.target.value })} />
        </LabeledField>
        <LabeledField label="预设名">
          <Input value={data.name} onChange={(e) => update({ name: e.target.value })} />
        </LabeledField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <LabeledField label="日志级别" raw="log-level" hint="日志详细程度。排查问题时可调高到 info / debug。">
          <Select value={data.log_level} onValueChange={(v) => update({ log_level: v as GeneralPresetData["log_level"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="silent">silent</SelectItem>
              <SelectItem value="warning">warning</SelectItem>
              <SelectItem value="notify">notify</SelectItem>
              <SelectItem value="info">info</SelectItem>
              <SelectItem value="debug">debug</SelectItem>
              <SelectItem value="verbose">verbose</SelectItem>
            </SelectContent>
          </Select>
        </LabeledField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <LabeledField label="节点测速 URL" raw="proxy-test-url" hint="测试各节点延迟用的 URL(返回 204)。">
          <Input
            value={data.proxy_test_url ?? ""}
            onChange={(e) => update({ proxy_test_url: e.target.value || undefined })}
            placeholder="http://cp.cloudflare.com/generate_204"
          />
        </LabeledField>
        <LabeledField label="连通性测试 URL" raw="internet-test-url" hint="测试本机互联网连通性的 URL。">
          <Input
            value={data.internet_test_url ?? ""}
            onChange={(e) => update({ internet_test_url: e.target.value || undefined })}
            placeholder="http://wifi.vivo.com.cn/generate_204"
          />
        </LabeledField>
      </div>
      <div className="divide-y rounded-md border">
        <ToggleRow
          label="IPv6"
          raw="ipv6"
          hint="启用 IPv6 协议栈支持。"
          checked={data.ipv6}
          onChange={(v) => update({ ipv6: v })}
          className="px-2.5"
        />
      </div>
    </div>
  );
}
