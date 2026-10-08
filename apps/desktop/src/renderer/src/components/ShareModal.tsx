import { useEffect, useState } from "react";
import { invoke } from "../lib/ipc";

type ShareTarget = { kind: "collection" | "folder" | "request"; id: string; name: string; workspaceId: string };

export function ShareModal(props: { target: ShareTarget; signedIn: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<{
    shares: Array<{ id: string; grantee_user_id: string; role: string; created_at: string }>;
    invitations: Array<{ id: string; email: string; role: string; expires_at: string; revoked_at: string | null; accepted_at: string | null }>;
  }>({ shares: [], invitations: [] });

  async function refresh() {
    if (!props.signedIn) return;
    const data = await invoke<typeof list>("share.list", {
      workspaceId: props.target.workspaceId,
      resourceKind: props.target.kind,
      resourceId: props.target.id
    });
    setList(data);
  }

  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [props.target.id]);

  async function invite() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await invoke<{ mode: string; email?: { sent?: boolean } }>("share.invite", {
        workspaceId: props.target.workspaceId,
        resourceKind: props.target.kind,
        resourceId: props.target.id,
        email,
        role
      });
      setEmail("");
      if (res.mode === "direct") setMessage("Access granted. They’ll see an in-app notification.");
      else if (res.email?.sent === false) setMessage("Invitation saved, but the email was not sent. Add RESEND_API_KEY to Edge Function secrets.");
      else setMessage("Invitation email sent. They can accept after verifying that address.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--muted)]">Share {props.target.kind}</div>
            <div className="text-sm font-medium">{props.target.name}</div>
          </div>
          <button className="text-sm text-[var(--muted)]" onClick={props.onClose}>
            Close
          </button>
        </div>
        {!props.signedIn ? (
          <p className="mt-4 text-sm text-[var(--muted)]">Sign in to share with another email address. Offline work stays on this Mac.</p>
        ) : (
          <>
            <p className="mt-3 text-xs text-[var(--muted)]">Viewer can inspect. Editor can change this item. Private credentials are not shared.</p>
            <div className="mt-3 flex gap-2">
              <input
                type="email"
                className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--canvas)] px-2 py-1.5 text-sm"
                placeholder="name@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <select className="rounded-md border border-[var(--border)] bg-[var(--canvas)] px-2 text-xs" value={role} onChange={(e) => setRole(e.target.value as "viewer" | "editor")}>
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
              <button disabled={busy || !email} className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50" onClick={() => void invite()}>
                Invite
              </button>
            </div>
            {message && <div className="mt-2 text-xs text-emerald-600">{message}</div>}
            {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
            <div className="mt-4 max-h-56 space-y-2 overflow-auto text-xs">
              {list.shares.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded border border-[var(--border)] px-2 py-1.5">
                  <span className="truncate">User {s.grantee_user_id.slice(0, 8)} · {s.role}</span>
                  <span className="flex gap-2">
                    <button className="text-[var(--accent)]" onClick={() => void invoke("share.manage", { action: "update_role", workspaceId: props.target.workspaceId, shareId: s.id, role: s.role === "viewer" ? "editor" : "viewer" }).then(refresh)}>
                      Make {s.role === "viewer" ? "editor" : "viewer"}
                    </button>
                    <button className="text-red-600" onClick={() => void invoke("share.manage", { action: "revoke_share", workspaceId: props.target.workspaceId, shareId: s.id }).then(refresh)}>
                      Revoke
                    </button>
                  </span>
                </div>
              ))}
              {list.invitations.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between rounded border border-[var(--border)] px-2 py-1.5">
                  <span className="truncate">
                    {inv.email} · {inv.role}
                    {inv.accepted_at ? " · accepted" : inv.revoked_at ? " · revoked" : ` · expires ${new Date(inv.expires_at).toLocaleDateString()}`}
                  </span>
                  {!inv.accepted_at && !inv.revoked_at && (
                    <button className="text-red-600" onClick={() => void invoke("share.manage", { action: "revoke_invite", workspaceId: props.target.workspaceId, invitationId: inv.id }).then(refresh)}>
                      Revoke
                    </button>
                  )}
                </div>
              ))}
              {list.shares.length === 0 && list.invitations.length === 0 && <div className="text-[var(--muted)]">No one else has access yet.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
