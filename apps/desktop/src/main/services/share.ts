import { runtime } from "./state.js";
import { supabaseAnonKey, supabaseUrl } from "../config.js";
import { flushSync } from "./cloud.js";

function shareErrorMessage(code: string, fallback: string) {
  const text = code.trim();
  if (text.includes("user_not_found") || (/not found/i.test(text) && !text.includes("resource_not_found"))) {
    return "No PostConet account uses that email. They must create an account in the app first.";
  }
  if (text.includes("cannot_share_with_self")) return "You already have access to this item.";
  if (text.includes("only_owner_can_share") || text.includes("forbidden")) {
    return "Only the workspace owner can share this item.";
  }
  if (text.includes("resource_not_found")) return "That item is not in this workspace yet. Save/sync it, then share.";
  if (text.includes("unauthorized") || /invalid jwt|session/i.test(text)) return "Sign in again, then try sharing.";
  if (text.includes("invalid_email")) return "Enter a valid email address.";
  if (text.includes("invalid_role") || text.includes("invalid_resource") || text.includes("unknown_action")) {
    return "Could not share this item. Close the dialog and try again.";
  }
  if (/non-2xx|Edge Function/i.test(text)) return fallback;
  return text || fallback;
}

async function invokeShare(name: string, body: unknown) {
  if (!runtime.supabase || !runtime.user) throw new Error("Sign in to share.");
  const { data: sessionData } = await runtime.supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Sign in again, then try sharing.");
  const res = await fetch(`${supabaseUrl().replace(/\/$/, "")}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey(),
      Authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  type SharePayload = { ok?: boolean; error?: string; message?: string; msg?: string; mode?: string };
  let payload: SharePayload | null = null;
  try {
    payload = raw ? (JSON.parse(raw) as SharePayload) : null;
  } catch {
    throw new Error(raw.slice(0, 180) || `Could not share (${res.status}).`);
  }
  const code = String(payload?.error || payload?.message || payload?.msg || "");
  if (payload?.ok) return payload;
  if (!res.ok || code) {
    throw new Error(shareErrorMessage(code, "Could not share this item. Make sure the other person has a PostConet account."));
  }
  return payload ?? {};
}

export async function inviteShare(input: {
  workspaceId: string;
  resourceKind: "collection" | "folder" | "request";
  resourceId: string;
  email: string;
  role: "viewer" | "editor";
}) {
  await flushSync();
  return invokeShare("share-invite", input);
}

export async function listShares(input: {
  workspaceId: string;
  resourceKind: "collection" | "folder" | "request";
  resourceId: string;
}) {
  if (!runtime.supabase || !runtime.user) return { shares: [], invitations: [] };
  try {
    const data = await invokeShare("share-manage", { action: "list", ...input });
    return { shares: (data as { shares?: unknown[] }).shares ?? [], invitations: (data as { invitations?: unknown[] }).invitations ?? [] };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Could not load people with access.");
  }
}

export async function manageShare(body: Record<string, unknown>) {
  if (!runtime.supabase || !runtime.user) throw new Error("Sign in required");
  return invokeShare("share-manage", body);
}
