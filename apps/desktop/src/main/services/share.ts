import { runtime } from "./state.js";

export async function inviteShare(input: {
  workspaceId: string;
  resourceKind: "collection" | "folder" | "request";
  resourceId: string;
  email: string;
  role: "viewer" | "editor";
}) {
  if (!runtime.supabase || !runtime.user) throw new Error("Sign in to share.");
  const { data, error } = await runtime.supabase.functions.invoke("share-invite", { body: input });
  const payload = data as { error?: string } | null;
  const code = payload?.error || (error ? String(error.message ?? error) : "");
  if (code.includes("user_not_found") || /not found/i.test(code)) {
    throw new Error("No PostConet account uses that email. They must create an account in the app first.");
  }
  if (code.includes("cannot_share_with_self")) throw new Error("You already have access to this item.");
  if (error) throw error;
  if (payload?.error) throw new Error(String(payload.error));
  return data;
}

export async function listShares(input: {
  workspaceId: string;
  resourceKind: "collection" | "folder" | "request";
  resourceId: string;
}) {
  if (!runtime.supabase || !runtime.user) return { shares: [], invitations: [] };
  const { data, error } = await runtime.supabase.functions.invoke("share-manage", {
    body: { action: "list", ...input }
  });
  if (error) throw error;
  return data ?? { shares: [], invitations: [] };
}

export async function manageShare(body: Record<string, unknown>) {
  if (!runtime.supabase || !runtime.user) throw new Error("Sign in required");
  const { data, error } = await runtime.supabase.functions.invoke("share-manage", { body });
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  return data;
}
