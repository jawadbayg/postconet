import { useState } from "react";
import { invoke } from "../lib/ipc";
import type { SessionInfo } from "../App";

type Mode = "signin" | "signup" | "reset";

export function AuthScreen(props: {
  cloudConfigured: boolean;
  onAuthed: (user: SessionInfo["user"]) => void;
  onContinueLocal: () => void;
  theme: "light" | "dark";
  onTheme: (t: "light" | "dark") => void;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "signup") {
        const res = await invoke<{ needsVerification: boolean; user: { id: string; email?: string } | null }>("auth.signUp", {
          email,
          password,
          displayName
        });
        if (res.needsVerification) setMessage("Check your email to verify your account, then sign in.");
        else if (res.user) {
          const user = await invoke<SessionInfo["user"]>("auth.signIn", { email, password });
          props.onAuthed(user);
        }
      } else if (mode === "reset") {
        await invoke("auth.resetPassword", { email });
        setMessage("If an account exists, a reset email is on its way.");
      } else {
        const user = await invoke<SessionInfo["user"]>("auth.signIn", { email, password });
        props.onAuthed(user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#f4f5f7] text-[#12151a] dark:bg-[#0f1115] dark:text-[#eef0f4]">
      <div className="titlebar-drag h-12" />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 pb-16">
        <div className="mb-8">
          <div className="text-xs uppercase tracking-[0.18em] text-[#667085]">API Studio</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#12151a] dark:text-[#eef0f4]">PostConet</h1>
          <p className="mt-2 text-sm text-[#667085]">Sign in with email. Project configuration is part of this build, not the login form.</p>
        </div>
        {!props.cloudConfigured && (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            Cloud accounts are unavailable until this build is given a Supabase URL and anon key. You can still work locally.
          </div>
        )}
        <form onSubmit={submit} className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm">
          {mode === "signup" && (
            <label className="block text-xs font-medium">
              Name
              <input className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </label>
          )}
          <label className="block text-xs font-medium">
            Email
            <input type="email" className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          {mode !== "reset" && (
            <label className="block text-xs font-medium">
              Password
              <input type="password" minLength={8} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
          )}
          {error && <div className="text-sm text-red-600">{error}</div>}
          {message && <div className="text-sm text-emerald-600">{message}</div>}
          <button disabled={busy || !props.cloudConfigured} className="w-full rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "Working…" : mode === "signup" ? "Create account" : mode === "reset" ? "Send reset email" : "Sign in"}
          </button>
        </form>
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
          <button className="underline" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
            {mode === "signup" ? "Have an account? Sign in" : "Create an account"}
          </button>
          <button className="underline" onClick={() => setMode("reset")}>Forgot password</button>
          <button className="underline" onClick={props.onContinueLocal}>Continue offline</button>
          <button className="underline" onClick={() => props.onTheme(props.theme === "dark" ? "light" : "dark")}>
            {props.theme === "dark" ? "Light" : "Dark"} theme
          </button>
        </div>
      </div>
    </div>
  );
}
