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
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
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
