import { useMemo, useState } from "react";
import yaml from "js-yaml";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

// @business_rule: 节点字段太多(每协议各异),用 YAML 而不是字段表来呈现 ——
// 1) 用户复制后可直接贴到 Clash proxies: 段验证;
// 2) 嵌套结构(ws_opts / reality_opts / wg peers / plugin_opts)天然好读;
// 3) 项目本来就以 YAML 为唯一真相,风格统一。
//
// 渲染前剔除 undefined / 空对象 / 空数组,避免一堆 `field: ~` 占视觉。
function cleanForYaml(node: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0) continue;
    out[k] = v;
  }
  return out;
}

export interface NodeDetailProps {
  node: Record<string, unknown> & {
    name: string;
    type: string;
    server: string;
    port: number;
  };
}

export function NodeDetail({ node }: NodeDetailProps) {
  const [copied, setCopied] = useState(false);

  const yamlText = useMemo(() => {
    return yaml.dump(cleanForYaml(node), { sortKeys: false, lineWidth: 200, noRefs: true });
  }, [node]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(yamlText);
      setCopied(true);
      toast({ title: "已复制 YAML", variant: "success" });
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast({ title: "复制失败", description: String(err), variant: "error" });
    }
  };

  return (
    <div className="relative">
      <pre className="select-text cursor-text font-mono text-[11px] leading-relaxed bg-muted/40 border rounded p-3 pr-20 whitespace-pre overflow-auto max-h-72">
        {yamlText}
      </pre>
      <Button
        size="sm"
        variant="secondary"
        onClick={onCopy}
        className="absolute top-2 right-2 h-7 px-2 text-xs"
        title="复制完整 YAML"
      >
        {copied ? (
          <>
            <Check className="h-3 w-3" />
            已复制
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            复制
          </>
        )}
      </Button>
    </div>
  );
}
