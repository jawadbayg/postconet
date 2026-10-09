import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from "react";
import { invoke } from "./lib/ipc";
import { AuthScreen } from "./screens/AuthScreen";
import { Studio } from "./screens/Studio";
import { BrandMark } from "./components/BrandMark";
import { DispatchLoaderFill } from "./components/DispatchLoader";

export type SessionInfo = {
  user: { id: string; email: string; displayName: string } | null;
  cloudConfigured: boolean;
  state?: string;
  error?: string | null;
  pending?: number;
  hydration?: { phase: string; detail?: string } | null;
};

export const LOCAL_USER = { id: "local", email: "", displayName: "Local" };

export function isCloudUser(user: SessionInfo["user"]) {
  return Boolean(user && user.id !== "local");
}

function withOfflineUser(session: SessionInfo): SessionInfo {
  if (!isCloudUser(session.user)) {
    return { ...session, user: LOCAL_USER };
  }
  return session;
}

export function mergeSyncStatus(prev: SessionInfo, payload: Partial<SessionInfo>): SessionInfo {
  const merged: SessionInfo = { ...prev, ...payload };
  if (!("user" in payload)) merged.user = prev.user;
  return withOfflineUser(merged);
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("PostConet UI error", error, info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-1 flex-col items-center justify-center gap-2 bg-[#f4f5f7] p-8 text-center text-[#12151a]">
          <BrandMark size={40} className="mb-2" />
          <div className="text-lg font-semibold">PostConet hit a UI error</div>
          <div className="max-w-lg text-sm text-[#667085]">{this.state.error.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** The startup loader stays on screen at least this long, even when the session answers instantly. */
const MIN_SPLASH_MS = 2000;

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [error, setError] = useState<string | null>(null);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSplashDone(true), MIN_SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    if (!session) return;
    void invoke<{ theme?: "light" | "dark" }>("settings.get")
      .then((s) => {
        if (s.theme === "dark" || s.theme === "light") setTheme(s.theme);
      })
      .catch(() => undefined);
  }, [session?.user?.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!window.postconet) {
          throw new Error("Desktop bridge unavailable");
        }
        const next = await Promise.race([
          invoke<SessionInfo>("auth.session"),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Startup timed out")), 4000))
        ]);
        if (!cancelled) setSession(withOfflineUser(next));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setSession(withOfflineUser({ user: null, cloudConfigured: false }));
        }
      }
    })();
    if (!window.postconet) return;
    return window.postconet.on("sync.status", (payload) => {
      setSession((prev) => mergeSyncStatus(prev ?? { user: null, cloudConfigured: false }, payload as SessionInfo));
    });
  }, []);

  if (!session || !splashDone) {
    return (
      <div className="flex min-h-screen flex-1 flex-col bg-[#f4f5f7] dark:bg-[#0f1115]">
        <DispatchLoaderFill size={180} />
      </div>
    );
  }

  if (session.user) {
    return (
      <ErrorBoundary>
        <Studio
          session={session}
          theme={theme}
          onTheme={(t) => {
            setTheme(t);
            void invoke("settings.set", { theme: t }).catch(() => undefined);
          }}
          onSession={setSession}
        />
      </ErrorBoundary>
    );
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      {error && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          {error}. You can continue offline.
        </div>
      )}
      <AuthScreen
        cloudConfigured={session.cloudConfigured}
        onAuthed={(user) => setSession({ ...session, user })}
        onContinueLocal={() => setSession({ ...session, user: LOCAL_USER })}
        theme={theme}
        onTheme={setTheme}
      />
    </div>
  );
}
