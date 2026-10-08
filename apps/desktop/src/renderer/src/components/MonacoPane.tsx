import { useEffect, useRef } from "react";
import "../monaco";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

export type MonacoPaneProps = {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
  language?: string;
  findRequest?: number;
  dark?: boolean;
};

export default function MonacoPane(props: MonacoPaneProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const dark = props.dark ?? (typeof document !== "undefined" && document.documentElement.classList.contains("dark"));

  useEffect(() => {
    if (!props.findRequest) return;
    const instance = editorRef.current;
    if (!instance) return;
    instance.focus();
    void instance.getAction("actions.find")?.run();
  }, [props.findRequest]);

  const onMount: OnMount = (instance, monaco) => {
    editorRef.current = instance;
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      enableSchemaRequest: false,
      schemas: [],
      trailingCommas: "error"
    });
    instance.updateOptions({
      glyphMargin: true,
      folding: true,
      showFoldingControls: "always",
      renderValidationDecorations: "on"
    });
  };

  return (
    <div className="h-full min-h-[160px] w-full overflow-hidden" style={{ height: props.height ?? "100%" }}>
      <Editor
        height="100%"
        language={props.language ?? "plaintext"}
        theme={dark ? "vs-dark" : "vs"}
        value={props.value}
        onMount={onMount}
        onChange={(value) => props.onChange?.(value ?? "")}
        loading={<div className="p-3 text-xs text-[#667085]">Loading editor…</div>}
        options={{
          readOnly: props.readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          tabSize: 2,
          automaticLayout: true,
          scrollBeyondLastLine: false,
          wordWrap: "on",
          lineNumbers: "on",
          glyphMargin: true,
          folding: true,
          showFoldingControls: "always",
          renderLineHighlight: "line",
          renderValidationDecorations: "on",
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          formatOnPaste: !props.readOnly,
          formatOnType: false,
          quickSuggestions: props.language === "javascript",
          suggestOnTriggerCharacters: props.language === "javascript",
          find: {
            addExtraSpaceOnTop: false,
            autoFindInSelection: "never",
            seedSearchStringFromSelection: "selection"
          },
          padding: { top: 8, bottom: 8 },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
        }}
      />
    </div>
  );
}
