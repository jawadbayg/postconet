import { Component, lazy, Suspense, type ErrorInfo, type ReactNode, useEffect, useState } from "react";

const MonacoPane = lazy(() => import("./MonacoPane"));

export type CodeEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
  language?: string;
  findRequest?: number;
};

function useDarkTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function FallbackEditor(props: CodeEditorProps) {
  return (
    <textarea
      className="box-border w-full resize-none border-0 bg-transparent p-3 font-mono text-xs leading-5 text-[var(--fg,#12151a)] outline-none"
      style={{ height: props.height ?? "100%" }}
      value={props.value}
      readOnly={props.readOnly}
      spellCheck={false}
      onChange={(e) => props.onChange?.(e.target.value)}
    />
  );
}

class EditorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Editor failed to load", error, info.componentStack);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function CodeEditor(props: CodeEditorProps) {
  const dark = useDarkTheme();
  const fallback = <FallbackEditor {...props} />;
  return (
    <EditorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <MonacoPane {...props} dark={dark} />
      </Suspense>
    </EditorBoundary>
  );
}
