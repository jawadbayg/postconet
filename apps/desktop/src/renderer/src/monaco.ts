import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "html" || label === "xml" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  }
};

loader.config({ monaco });

monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: false,
  enableSchemaRequest: false,
  schemas: [],
  trailingCommas: "error"
});

/** Keep in sync with CSS tokens in styles/index.css */
const LIGHT = {
  canvas: "#f4f5f7",
  panel: "#ffffff",
  border: "#e2e5ea",
  muted: "#667085",
  fg: "#12151a",
  accent: "#2563eb"
} as const;

const DARK = {
  canvas: "#0f1115",
  panel: "#171a21",
  border: "#2a2f3a",
  muted: "#98a2b3",
  fg: "#eef0f4",
  accent: "#3b82f6"
} as const;

export const POSTCONET_THEME_LIGHT = "postconet-light";
export const POSTCONET_THEME_DARK = "postconet-dark";

type ThemeTokens = {
  canvas: string;
  panel: string;
  border: string;
  muted: string;
  fg: string;
  accent: string;
};

function editorChrome(t: ThemeTokens): monaco.editor.IColors {
  const alpha = (hex: string, a: string) => `${hex}${a}`;
  return {
    "editor.background": t.canvas,
    "editor.foreground": t.fg,
    "editorGutter.background": t.canvas,
    "editorLineNumber.foreground": t.muted,
    "editorLineNumber.activeForeground": t.fg,
    "editorCursor.foreground": t.accent,
    "editor.selectionBackground": alpha(t.accent, "4D"),
    "editor.inactiveSelectionBackground": alpha(t.accent, "33"),
    "editor.selectionHighlightBackground": alpha(t.accent, "26"),
    "editor.wordHighlightBackground": alpha(t.accent, "26"),
    "editor.wordHighlightStrongBackground": alpha(t.accent, "33"),
    "editor.lineHighlightBackground": t.panel,
    "editor.lineHighlightBorder": "#00000000",
    "editorWidget.background": t.panel,
    "editorWidget.foreground": t.fg,
    "editorWidget.border": t.border,
    "editorSuggestWidget.background": t.panel,
    "editorSuggestWidget.border": t.border,
    "editorSuggestWidget.foreground": t.fg,
    "editorSuggestWidget.selectedBackground": alpha(t.accent, "33"),
    "editorHoverWidget.background": t.panel,
    "editorHoverWidget.border": t.border,
    "editorHoverWidget.foreground": t.fg,
    "input.background": t.panel,
    "input.foreground": t.fg,
    "input.border": t.border,
    focusBorder: t.accent,
    "scrollbarSlider.background": alpha(t.muted, "59"),
    "scrollbarSlider.hoverBackground": alpha(t.muted, "8C"),
    "scrollbarSlider.activeBackground": alpha(t.muted, "B3"),
    "editorIndentGuide.background": t.border,
    "editorIndentGuide.activeBackground": t.muted,
    "editorIndentGuide.background1": t.border,
    "editorIndentGuide.activeBackground1": t.muted,
    "editorBracketMatch.background": alpha(t.accent, "26"),
    "editorBracketMatch.border": t.accent,
    "editorOverviewRuler.border": t.border,
    "editorOverviewRuler.background": t.canvas,
    "minimap.background": t.canvas,
    "editorStickyScroll.background": t.canvas,
    "editorStickyScrollHover.background": t.panel,
    "editor.foldBackground": alpha(t.accent, "1A"),
    "editor.findMatchBackground": alpha(t.accent, "66"),
    "editor.findMatchHighlightBackground": alpha(t.accent, "33"),
    "editor.findRangeHighlightBackground": alpha(t.accent, "1A"),
    "peekViewEditor.background": t.canvas,
    "peekViewResult.background": t.panel,
    "peekViewTitle.background": t.panel,
    "dropdown.background": t.panel,
    "dropdown.foreground": t.fg,
    "dropdown.border": t.border,
    "list.hoverBackground": alpha(t.accent, "26"),
    "list.activeSelectionBackground": alpha(t.accent, "4D"),
    "list.inactiveSelectionBackground": alpha(t.accent, "33"),
    "menu.background": t.panel,
    "menu.foreground": t.fg,
    "menu.separatorBackground": t.border,
    "menu.selectionBackground": alpha(t.accent, "33")
  };
}

monaco.editor.defineTheme(POSTCONET_THEME_LIGHT, {
  base: "vs",
  inherit: true,
  rules: [],
  colors: editorChrome(LIGHT)
});

monaco.editor.defineTheme(POSTCONET_THEME_DARK, {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: editorChrome(DARK)
});
