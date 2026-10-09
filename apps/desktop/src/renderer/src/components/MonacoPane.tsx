import { useEffect, useRef } from "react";
import { POSTCONET_THEME_DARK, POSTCONET_THEME_LIGHT } from "../monaco";
import { DispatchLoaderFill } from "./DispatchLoader";
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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const dark = props.dark ?? (typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  const language = props.language ?? "plaintext";
  const isCode = language === "json" || language === "javascript" || language === "xml" || language === "html";

  useEffect(() => {
    if (!props.findRequest) return;
    const instance = editorRef.current;
    if (!instance) return;
    instance.focus();
    void instance.getAction("actions.find")?.run();
  }, [props.findRequest]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => editorRef.current?.layout());
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const onMount: OnMount = (instance, monaco) => {
    editorRef.current = instance;
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      enableSchemaRequest: false,
      schemas: [],
      trailingCommas: "error"
    });
    const model = instance.getModel();
    if (model && language) monaco.editor.setModelLanguage(model, language);
    instance.updateOptions({
      glyphMargin: true,
      folding: true,
      showFoldingControls: "always",
      renderValidationDecorations: "on"
    });
    requestAnimationFrame(() => instance.layout());
  };

  return (
    <div ref={hostRef} className="h-full min-h-[160px] w-full overflow-hidden bg-[var(--canvas)]" style={{ height: props.height ?? "100%" }}>
      <Editor
        height="100%"
        language={language}
        theme={dark ? POSTCONET_THEME_DARK : POSTCONET_THEME_LIGHT}
        value={props.value}
        onMount={onMount}
        onChange={(value) => props.onChange?.(value ?? "")}
        loading={<DispatchLoaderFill size={100} />}
        options={{
          readOnly: props.readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          tabSize: 2,
          insertSpaces: true,
          detectIndentation: false,
          automaticLayout: true,
          scrollBeyondLastLine: false,
          wordWrap: "on",
          lineNumbers: "on",
          glyphMargin: true,
          folding: true,
          showFoldingControls: "always",
          renderLineHighlight: "line",
          renderValidationDecorations: "on",
          matchBrackets: "always",
          autoClosingBrackets: "always",
          autoClosingQuotes: "always",
          autoIndent: "full",
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          formatOnPaste: !props.readOnly,
          formatOnType: !props.readOnly && language === "json",
          quickSuggestions: isCode,
          suggestOnTriggerCharacters: isCode,
          tabCompletion: "on",
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
