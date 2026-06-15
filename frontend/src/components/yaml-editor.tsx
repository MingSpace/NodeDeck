import { Loader2 } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef } from "react";
import type { OnMount } from "@monaco-editor/react";
import { computeLineDiff } from "@/lib/line-diff";

// Monaco 体积大(几 MB),拆出独立 chunk 按需加载。这一层 lazy 确保:
// - 即使路由级 lazy 已经把 ProvidersPage 等页面切出去了,页面挂载时也不会立刻加载 Monaco
// - 用户点开 yaml 编辑对话框 / 切到 profile-editor 的 YAML 模式时才真正下载
// - dialog 关闭后 chunk 仍在内存,后续打开零延迟
const Editor = lazy(async () => {
  const m = await import("@monaco-editor/react");
  return { default: m.Editor };
});

type MonacoEditor = Parameters<OnMount>[0];
type MonacoNs = Parameters<OnMount>[1];
type DeltaDecoration = Parameters<MonacoEditor["deltaDecorations"]>[1][number];

interface YamlEditorProps {
  value: string;
  onChange: (v: string) => void;
  height?: number | string;
  language?: "yaml" | "ini" | "javascript";
  readOnly?: boolean;
  // 启用后,value 变化时会对新增行做绿色高亮 + 淡出动画(用于实时预览的 diff 提示)。
  highlightChanges?: boolean;
  // diff 完成时回调,把 +N / -M 统计交给上层 UI 显示徽章。
  onDiffStats?: (stats: { added: number; removed: number }) => void;
}

const HIGHLIGHT_DURATION_MS = 1600;

export function YamlEditor({
  value,
  onChange,
  height = 400,
  language = "yaml",
  readOnly = false,
  highlightChanges = false,
  onDiffStats,
}: YamlEditorProps) {
  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<MonacoNs | null>(null);
  const prevValueRef = useRef<string>(value);
  const prevLanguageRef = useRef<string>(language);
  const decorationsRef = useRef<string[]>([]);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    monaco.editor.defineTheme("nodedeck-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: { "editor.background": "#ffffff" },
    });
  }, []);

  useEffect(() => {
    if (!highlightChanges) {
      prevValueRef.current = value;
      prevLanguageRef.current = language;
      return;
    }
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) {
      prevValueRef.current = value;
      prevLanguageRef.current = language;
      return;
    }

    // language 切换(Clash YAML <-> Surge .conf) 时整体文本会大改,
    // diff 没意义,直接 reset baseline 并清掉残留装饰。
    if (prevLanguageRef.current !== language) {
      prevLanguageRef.current = language;
      prevValueRef.current = value;
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      onDiffStats?.({ added: 0, removed: 0 });
      return;
    }

    const prev = prevValueRef.current;
    const next = value;
    if (prev === next) return;

    const { addedLines, addedCount, removedCount } = computeLineDiff(prev, next);
    onDiffStats?.({ added: addedCount, removed: removedCount });

    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);

    if (addedLines.length === 0) {
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
    } else {
      const decorations: DeltaDecoration[] = addedLines.map((lineNumber) => ({
        range: new monaco.Range(lineNumber, 1, lineNumber, 1),
        options: {
          isWholeLine: true,
          className: "preview-line-added",
        },
      }));
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);
      clearTimerRef.current = setTimeout(() => {
        const ed = editorRef.current;
        if (ed) {
          decorationsRef.current = ed.deltaDecorations(decorationsRef.current, []);
        }
      }, HIGHLIGHT_DURATION_MS);
    }

    prevValueRef.current = next;
  }, [value, language, highlightChanges, onDiffStats]);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  return (
    <div className="border rounded-md overflow-hidden" style={{ height }}>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            编辑器加载中…
          </div>
        }
      >
        <Editor
          value={value}
          onChange={(v) => onChange(v ?? "")}
          height="100%"
          language={language}
          theme="vs"
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            tabSize: 2,
            scrollBeyondLastLine: false,
            renderWhitespace: "boundary",
            wordWrap: "on",
            readOnly,
          }}
        />
      </Suspense>
    </div>
  );
}
