import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Eye, RefreshCw } from "lucide-react";
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
const HEIGHT_STORAGE_KEY = "mconvert.preview-pane.height";
const MIN_HEIGHT = 200;
const TOP_RESERVED = 200;

function getDefaultHeight(): number {
  if (typeof window === "undefined") return MIN_HEIGHT;
  return Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.3));
}

function clampHeight(h: number): number {
  if (typeof window === "undefined") return Math.max(MIN_HEIGHT, h);
  const max = Math.max(MIN_HEIGHT, window.innerHeight - TOP_RESERVED);
  return Math.min(max, Math.max(MIN_HEIGHT, h));
}

function readStoredHeight(): number {
  if (typeof window === "undefined") return getDefaultHeight();
  try {
    const raw = window.localStorage.getItem(HEIGHT_STORAGE_KEY);
    if (!raw) return getDefaultHeight();
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return getDefaultHeight();
    return clampHeight(n);
  } catch {
    return getDefaultHeight();
  }
}

export function PreviewPane({ profileId, draft, enabled }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [target, setTarget] = useState<"clash" | "surge">("clash");
  const preview = useGeneratedPreview(profileId, target, draft, enabled && !collapsed);
  const [diffStats, setDiffStats] = useState<{ added: number; removed: number } | null>(null);
  const diffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [height, setHeight] = useState<number>(() => readStoredHeight());
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);

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
      const deltaY = e.clientY - st.startY;
      setHeight(clampHeight(st.startHeight - deltaY));
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
      window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(height));
    } catch {
      // ignore quota / privacy mode errors
    }
  }, [height, dragging]);

  useEffect(() => {
    const onResize = () => setHeight((h) => clampHeight(h));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStateRef.current = { startY: e.clientY, startHeight: height };
      setDragging(true);
    },
    [height],
  );

  const resetHeight = useCallback(() => {
    setHeight(getDefaultHeight());
  }, []);

  return (
    <div
      className="relative border-t bg-card flex flex-col shrink-0"
      style={{ height: collapsed ? "auto" : height, minHeight: collapsed ? 0 : MIN_HEIGHT }}
    >
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="拖拽调整预览区高度"
          title="拖拽调整高度,双击重置"
          onMouseDown={startDrag}
          onDoubleClick={resetHeight}
          className={
            "absolute -top-1 left-0 right-0 h-2 z-10 cursor-row-resize group flex items-center justify-center " +
            (dragging ? "select-none" : "")
          }
        >
          <span
            className={
              "block h-0.5 w-12 rounded-full transition-colors " +
              (dragging
                ? "bg-primary"
                : "bg-border group-hover:bg-muted-foreground/60")
            }
          />
        </div>
      )}
      {dragging && (
        <div
          className="fixed inset-0 z-50 cursor-row-resize select-none"
          style={{ background: "transparent" }}
        />
      )}
      <div className="px-4 py-2 border-b flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          <Eye className="h-3.5 w-3.5" />
          实时预览
        </button>
        {!collapsed && (
          <>
            <Tabs value={target} onValueChange={(v) => setTarget(v as "clash" | "surge")}>
              <TabsList className="h-7">
                <TabsTrigger value="clash" className="text-xs px-2 py-0.5">
                  Clash YAML
                </TabsTrigger>
                <TabsTrigger value="surge" className="text-xs px-2 py-0.5">
                  Surge .conf
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => preview.refetch()} disabled={preview.isFetching}>
              <RefreshCw className={preview.isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            </Button>
            {diffStats && (diffStats.added > 0 || diffStats.removed > 0) && (
              <Badge
                variant="outline"
                className="text-xs font-mono tabular-nums transition-opacity duration-500"
                title="本次预览相比上次的行数变化"
              >
                {diffStats.added > 0 && <span className="text-emerald-600">+{diffStats.added}</span>}
                {diffStats.added > 0 && diffStats.removed > 0 && <span className="mx-1 text-muted-foreground">/</span>}
                {diffStats.removed > 0 && <span className="text-rose-600">-{diffStats.removed}</span>}
              </Badge>
            )}
            {preview.data && (
              <Badge variant="outline" className="text-xs">
                {preview.data.node_count} 个节点
              </Badge>
            )}
          </>
        )}
      </div>

      {!collapsed && (
        <>
          {preview.error && preview.data && (
            <Card className="mx-2 my-1 p-2 text-xs bg-destructive/10 border-destructive/30 text-destructive shrink-0">
              刷新失败,显示的是上次的预览: {String(preview.error)}
            </Card>
          )}
          {preview.data?.warnings && preview.data.warnings.length > 0 && (
            <Card className="mx-2 my-1 p-2 text-xs bg-amber-50 border-amber-200 text-amber-900 shrink-0 max-h-24 overflow-auto">
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
        </>
      )}
    </div>
  );
}
