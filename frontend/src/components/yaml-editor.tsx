import { Editor, type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useRef } from "react";
import { computeLineDiff } from "@/lib/line-diff";

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
    monaco.editor.defineTheme("mconvert-light", {
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
    </div>
  );
}
