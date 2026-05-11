import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { NodeDetail } from "@/components/node-detail";

// @business_rule: 节点接口已经全字段下发,这里用宽松类型透传,
// 折叠态只用 NodeBrief 里的几个常用字段,展开态把整个对象交给 NodeDetail 渲染 YAML。
export interface NodeBrief {
  name: string;
  type: string;
  server: string;
  port: number;
  source_provider_id?: string;
  region?: string;
  level?: string;
  line?: string;
  tags?: string[];
  [key: string]: unknown;
}

export function NodeRow({ n }: { n: NodeBrief }) {
  const [expanded, setExpanded] = useState(false);

  // @user_flow: 点击行 → toggle 展开 → 显示完整 YAML(含 password / uuid 等);
  // 父级 Card 整张是 cursor-pointer(收起整个 Provider 卡片),所以这里必须 stopPropagation,
  // 否则展开节点的同时会把整个 Provider 卡片收起来。
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  return (
    <div className="select-none">
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30"
        onClick={onClick}
      >
        <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 shrink-0">
          {n.type}
        </Badge>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{n.name}</div>
          <div className="text-xs text-muted-foreground truncate">
            {n.server}:{n.port}
            {n.region && ` · ${n.region}`}
            {n.level && ` · ${n.level}`}
            {n.line && ` · ${n.line}`}
            {n.source_provider_id && ` · ${n.source_provider_id}`}
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </div>
      {expanded && (
        <div
          className="border-t bg-muted/20 p-3"
          onClick={(e) => e.stopPropagation()}
        >
          <NodeDetail node={n} />
        </div>
      )}
    </div>
  );
}
