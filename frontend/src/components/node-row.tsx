import { Badge } from "@/components/ui/badge";

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
}

export function NodeRow({ n }: { n: NodeBrief }) {
  return (
    <div className="flex items-center gap-3 p-3 hover:bg-muted/30">
      <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
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
    </div>
  );
}
