import { useState } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { invoke } from "../lib/ipc";
import type { SessionInfo } from "../App";
import authBackgroundDark from "../../../../../../resources/icons/postconet-auth-background.svg?url";
import authBackgroundLight from "../../../../../../resources/icons/postconet-auth-background-light.svg?url";
import { BrandMark } from "../components/BrandMark";
import { DispatchLoaderOverlay } from "../components/DispatchLoader";
import { ConfirmDialog } from "../components/ConfirmDialog";

type Mode = "signin" | "signup";

function passwordRules(password: string) {
  return {
    length: password.length >= 6,
    letter: /[A-Za-z]/.test(password),
    number: /\d/.test(password)
  };
}

function passwordIsValid(password: string) {
  const rules = passwordRules(password);
  return rules.length && rules.letter && rules.number;
}

function Rule(props: { met: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-1.5 ${props.met ? "text-emerald-600" : "text-[var(--muted)]"}`}>
      <Check size={12} strokeWidth={2.5} aria-hidden className={props.met ? "" : "invisible"} />
      {props.label}
    </li>
  );
}

type SignInResult = {
  user: SessionInfo["user"];
  pending?: boolean;
  localData?: { collections: number; requests: number; environments: number } | null;
};

export function AuthScreen(props: {
  cloudConfigured: boolean;
  onAuthed: (user: SessionInfo["user"]) => void;
  onContinueLocal: () => void;
  theme: "light" | "dark";
  onTheme: (t: "light" | "dark") => void;
  initialMode?: Mode | "reset";
}) {
  const [mode, setMode] = useState<Mode>(props.initialMode === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [merge, setMerge] = useState<SignInResult | null>(null);

  async function finishSignIn(mergeLocal: boolean) {
    setBusy(true);
    setError(null);
    try {
      const user = await invoke<SessionInfo["user"]>("auth.completeSignIn", { mergeLocal });
      setMerge(null);
      props.onAuthed(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (mode === "signup") {
      if (!passwordIsValid(password)) {
        setError("Use at least 6 characters, including a letter and a number.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        await invoke("auth.signUp", { email, password, displayName });
      }
      const result = await invoke<SignInResult>("auth.signIn", { email, password });
      if (result.pending && result.localData) {
        setMerge(result);
        return;
      }
      props.onAuthed(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const local = merge?.localData;
  const rules = passwordRules(password);
  const passwordOk = passwordIsValid(password);
  const confirmOk = confirmPassword.length > 0 && confirmPassword === password;
  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== password;
  const shownError =
    mode === "signup" && passwordOk && error === "Use at least 6 characters, including a letter and a number."
      ? null
      : mode === "signup" && confirmOk && error === "Passwords do not match."
        ? null
        : error;

  function switchMode() {
    setMode(mode === "signup" ? "signin" : "signup");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirm(false);
    setError(null);
    setMessage(null);
  }

  const dark = props.theme === "dark";

  return (
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden bg-[#f4f5f7] text-[#12151a] dark:bg-[#0f1115] dark:text-[#eef0f4]">
      <div className="grid h-full min-h-0 w-full grid-cols-2 overflow-hidden">
        <div className="relative flex h-full flex-col items-center justify-center overflow-hidden border-r border-[var(--border)] px-10 text-center">
          <img src={dark ? authBackgroundDark : authBackgroundLight} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
          <div className="relative flex flex-col items-center">
            <BrandMark size={64} className="mb-5" />
            <div className={`text-xs uppercase tracking-[0.18em] ${dark ? "text-[#c5cedd]" : "text-[#667085]"}`}>API Studio</div>
            <h1 className={`mt-2 text-3xl font-semibold tracking-tight ${dark ? "text-white" : "text-[#12151a]"}`}>PostConet</h1>
            <p className={`mt-3 max-w-xs text-sm ${dark ? "text-[#c5cedd]" : "text-[#667085]"}`}>
              {mode === "signup" ? "Create an in-app account and sign in." : "Sign in to your in-app account."}
            </p>
          </div>
        </div>
        <div className="titlebar-no-drag flex h-full min-h-0 flex-col justify-center overflow-y-auto px-8">
          <div className="mx-auto w-full max-w-md">
        <form onSubmit={submit} className="relative space-y-3 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm">
          {busy && <DispatchLoaderOverlay size={120} />}
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
          <div>
            <label htmlFor="auth-password" className="block text-xs font-medium">Password</label>
            <div className="relative mt-1">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--canvas)] py-2 pl-3 pr-10 text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[var(--muted)]"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((open) => !open)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {mode === "signup" && (
              <ul className="mt-2 space-y-1 text-[11px]">
                <Rule met={rules.length} label="At least 6 characters" />
                <Rule met={rules.letter} label="At least 1 letter" />
                <Rule met={rules.number} label="At least 1 number" />
              </ul>
            )}
          </div>
          {mode === "signup" && (
            <div>
              <label htmlFor="auth-confirm" className="block text-xs font-medium">Confirm password</label>
              <div className="relative mt-1">
                <input
                  id="auth-confirm"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--canvas)] py-2 pl-3 pr-16 text-sm"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
                <span className="pointer-events-none absolute inset-y-0 right-10 flex items-center">
                  {confirmOk && <Check className="text-emerald-600" size={16} strokeWidth={2.5} aria-label="Passwords match" />}
                </span>
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[var(--muted)]"
                  aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"}
                  onClick={() => setShowConfirm((open) => !open)}
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {confirmMismatch && <p className="mt-1 text-[11px] text-red-600">Passwords do not match.</p>}
            </div>
          )}
          {shownError && <div className="text-sm text-red-600">{shownError}</div>}
          {message && <div className="text-sm text-emerald-600">{message}</div>}
          <button disabled={busy || !props.cloudConfigured || (mode === "signup" && (!passwordOk || !confirmOk))} className="w-full rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
          <button className="underline" onClick={switchMode}>
            {mode === "signup" ? "Have an account? Sign in" : "Create an account"}
          </button>
          <button className="underline" onClick={props.onContinueLocal}>Continue offline</button>
        </div>
          </div>
        </div>
      </div>
      {merge && local && (
        <ConfirmDialog
          title="Sync offline data?"
          body={`This Mac has ${local.collections} collection${local.collections === 1 ? "" : "s"} and ${local.requests} API${local.requests === 1 ? "" : "s"} from offline use. Upload them to your account, or keep them only on this Mac?`}
          confirmLabel="Sync to account"
          cancelLabel="Don't sync"
          danger={false}
          onConfirm={() => void finishSignIn(true)}
          onCancel={() => void finishSignIn(false)}
        />
      )}
    </div>
  );
}
