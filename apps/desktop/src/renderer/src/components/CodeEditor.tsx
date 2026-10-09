import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from "react";
import MonacoPane from "./MonacoPane";

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

class EditorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Editor failed to load", error, info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return <div className="p-3 text-xs text-red-600">Code editor failed to load: {this.state.error.message}</div>;
    }
    return this.props.children;
  }
}

export function CodeEditor(props: CodeEditorProps) {
  const dark = useDarkTheme();
  return (
    <EditorBoundary>
      <MonacoPane {...props} dark={dark} />
    </EditorBoundary>
  );
}
