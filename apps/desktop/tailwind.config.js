/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/renderer/index.html", "./src/renderer/src/**/*.{ts,tsx}"],
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        panel: "var(--panel)",
        border: "var(--border)",
        muted: "var(--muted)",
        fg: "var(--fg)",
        accent: "var(--accent)"
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "SF Pro Text", "Inter", "sans-serif"],
        mono: ["ui-monospace", "SF Mono", "JetBrains Mono", "Menlo", "monospace"]
      }
    }
  },
  plugins: []
};
