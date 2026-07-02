import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { YamlEditor } from "@/components/yaml-editor";
import { useGeneratedPreview } from "./use-profile-form";
import type { Profile } from "./types";

interface Props {
  profileId: string;
  draft: Profile | null;
  enabled: boolean;
}

const DIFF_BADGE_VISIBLE_MS = 1800;
const WIDTH_STORAGE_KEY = "nodedeck.preview-pane.width";
const MIN_WIDTH = 340;
// 给左侧编辑区保留的最小宽度,避免预览面板把编辑区挤到不可用。
const LEFT_RESERVED = 560;

function getDefaultWidth(): number {
  if (typeof window === "undefined") return MIN_WIDTH;
  return Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.34));
}

function clampWidth(w: number): number {
  if (typeof window === "undefined") return Math.max(MIN_WIDTH, w);
  const max = Math.max(MIN_WIDTH, window.innerWidth - LEFT_RESERVED);
  return Math.min(max, Math.max(MIN_WIDTH, w));
}

function readStoredWidth(): number {
  if (typeof window === "undefined") return getDefaultWidth();
  try {
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    if (!raw) return getDefaultWidth();
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return getDefaultWidth();
    return clampWidth(n);
  } catch {
    return getDefaultWidth();
  }
}

export function PreviewPane({ profileId, draft, enabled }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [target, setTarget] = useState<"clash" | "surge">("clash");
  const preview = useGeneratedPreview(profileId, target, draft, enabled && !collapsed);
  const [diffStats, setDiffStats] = useState<{ added: number; removed: number } | null>(null);
  const diffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [width, setWidth] = useState<number>(() => readStoredWidth());
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleDiffStats = useCallback((stats: { added: number; removed: number }) => {
    if (stats.added === 0 && stats.removed === 0) {
      setDiffStats(null);
      return;
    }
    setDiffStats(stats);
    if (diffTimerRef.current) clearTimeout(diffTimerRef.current);
    diffTimerRef.current = setTimeout(() => setDiffStats(null), DIFF_BADGE_VISIBLE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (diffTimerRef.current) clearTimeout(diffTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const st = dragStateRef.current;
      if (!st) return;
      const deltaX = e.clientX - st.startX;
      // 拖拽柄在面板左缘:向左拖(deltaX<0)增大宽度。
      setWidth(clampWidth(st.startWidth - deltaX));
    };
    const onUp = () => {
      setDragging(false);
      dragStateRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  useEffect(() => {
    if (dragging) return;
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
    } catch {
      // ignore quota / privacy mode errors
    }
  }, [width, dragging]);

  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStateRef.current = { startX: e.clientX, startWidth: width };
      setDragging(true);
    },
    [width],
  );

  const resetWidth = useCallback(() => {
    setWidth(getDefaultWidth());
  }, []);

  // 折叠态:整条面板收成最右一条窄竖条,把横向空间全部还给编辑区。
  if (collapsed) {
    return (
      <div className="border-l bg-card shrink-0 w-10 flex flex-col">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="展开实时预览"
          className="flex-1 flex flex-col items-center gap-2 pt-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          <Eye className="h-3.5 w-3.5" />
          <span className="[writing-mode:vertical-rl] tracking-wide mt-1">实时预览</span>
        </button>
      </div>
    );
  }

  const hasStatusRow = !!preview.data || !!diffStats;

  return (
    <div
      className="relative border-l bg-card flex flex-col shrink-0 min-h-0"
      style={{ width, minWidth: MIN_WIDTH }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="拖拽调整预览区宽度"
        title="拖拽调整宽度,双击重置"
        onMouseDown={startDrag}
        onDoubleClick={resetWidth}
        className={
          "absolute -left-1 top-0 bottom-0 w-2 z-10 cursor-col-resize group flex items-center justify-center " +
          (dragging ? "select-none" : "")
        }
      >
        <span
          className={
            "block w-0.5 h-12 rounded-full transition-colors " +
            (dragging ? "bg-primary" : "bg-border group-hover:bg-muted-foreground/60")
          }
        />
      </div>
      {dragging && (
        <div
          className="fixed inset-0 z-50 cursor-col-resize select-none"
          style={{ background: "transparent" }}
        />
      )}

      <div className="px-3 py-2 border-b flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          title="折叠预览"
        >
          <ChevronRight className="h-3.5 w-3.5" />
          <Eye className="h-3.5 w-3.5" />
          实时预览
        </button>
        <Tabs value={target} onValueChange={(v) => setTarget(v as "clash" | "surge")}>
          <TabsList className="h-7">
            <TabsTrigger value="clash" className="text-xs px-2 py-0.5" title="Clash YAML">
              Clash
            </TabsTrigger>
            <TabsTrigger value="surge" className="text-xs px-2 py-0.5" title="Surge .conf">
              Surge
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => preview.refetch()} disabled={preview.isFetching}>
          <RefreshCw className={preview.isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
        </Button>
      </div>

      {hasStatusRow && (
        <div className="px-3 py-1.5 border-b flex items-center gap-2 flex-wrap shrink-0">
          {preview.data && (
            <Badge variant="outline" className="text-xs">
              {preview.data.node_count} 个节点
            </Badge>
          )}
          {diffStats && (diffStats.added > 0 || diffStats.removed > 0) && (
            <Badge
              variant="outline"
              className="text-xs font-mono tabular-nums"
              title="本次预览相比上次的行数变化"
            >
              {diffStats.added > 0 && <span className="text-emerald-600">+{diffStats.added}</span>}
              {diffStats.added > 0 && diffStats.removed > 0 && <span className="mx-1 text-muted-foreground">/</span>}
              {diffStats.removed > 0 && <span className="text-rose-600">-{diffStats.removed}</span>}
            </Badge>
          )}
          {preview.data?.revalidating && (
            <Badge
              variant="outline"
              className="text-xs gap-1 border-amber-300 text-amber-700 bg-amber-50"
              title="部分机场首次无缓存,正在后台拉取节点,完成后会自动刷新预览"
            >
              <RefreshCw className="h-3 w-3 animate-spin" />
              首次拉取节点中…
            </Badge>
          )}
        </div>
      )}

      {preview.error && preview.data && (
        <Card className="mx-2 my-1 p-2 text-xs bg-destructive/10 border-destructive/30 text-destructive shrink-0">
          刷新失败,显示的是上次的预览: {String(preview.error)}
        </Card>
      )}
      {preview.data?.warnings && preview.data.warnings.length > 0 && (
        <Card className="mx-2 my-1 p-2 text-xs bg-amber-50 border-amber-200 text-amber-900 shrink-0 max-h-32 overflow-auto">
          <div className="font-medium mb-1">{preview.data.warnings.length} 条警告:</div>
          <ul className="list-disc list-inside space-y-0.5">
            {preview.data.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Card>
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        {preview.isLoading && <div className="p-4 text-xs text-muted-foreground">生成中...</div>}
        {preview.error && !preview.data && (
          <div className="p-4 text-xs text-destructive">预览失败: {String(preview.error)}</div>
        )}
        {preview.data && (
          <YamlEditor
            value={preview.data.text}
            onChange={() => {}}
            language={target === "clash" ? "yaml" : "ini"}
            readOnly
            height="100%"
            highlightChanges
            onDiffStats={handleDiffStats}
          />
        )}
      </div>
    </div>
  );
}
