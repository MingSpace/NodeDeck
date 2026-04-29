import { Editor, type OnMount } from "@monaco-editor/react";
import { useCallback } from "react";

interface YamlEditorProps {
  value: string;
  onChange: (v: string) => void;
  height?: number | string;
  language?: "yaml" | "ini" | "javascript";
  readOnly?: boolean;
}

export function YamlEditor({ value, onChange, height = 400, language = "yaml", readOnly = false }: YamlEditorProps) {
  const handleMount: OnMount = useCallback((_editor, monaco) => {
    monaco.editor.defineTheme("mconvert-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: { "editor.background": "#ffffff" },
    });
  }, []);
  return (
    <div className="border rounded-md overflow-hidden">
      <Editor
        value={value}
        onChange={(v) => onChange(v ?? "")}
        height={height}
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
