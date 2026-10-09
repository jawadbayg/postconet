import { Moon, Sun } from "lucide-react";

export function ThemeToggle(props: {
  theme: "light" | "dark";
  onTheme: (theme: "light" | "dark") => void;
  className?: string;
}) {
  const next = props.theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      title={next === "light" ? "Day theme" : "Night theme"}
      aria-label={next === "light" ? "Switch to day theme" : "Switch to night theme"}
      className={
        props.className ??
        "flex h-[26px] w-[30px] items-center justify-center rounded-md border border-[var(--border)] text-[var(--fg)]"
      }
      onClick={() => props.onTheme(next)}
    >
      {props.theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
