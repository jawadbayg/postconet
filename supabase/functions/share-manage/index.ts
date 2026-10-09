import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { cors, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user) return json({ error: "unauthorized" }, 401);

  const body = await req.json() as {
    action: "list" | "revoke_share" | "revoke_invite" | "update_role";
    workspaceId: string;
    resourceKind?: "collection" | "folder" | "request";
    resourceId?: string;
    shareId?: string;
    invitationId?: string;
    role?: "viewer" | "editor";
  };

  const { data: owner } = await userClient.rpc("is_workspace_owner", { ws: body.workspaceId });
  if (!owner && body.action !== "list") return json({ error: "forbidden" });

  if (body.action === "list") {
    const shares = await userClient
      .from("resource_shares")
      .select("id, resource_kind, resource_id, grantee_user_id, role, created_at")
      .eq("workspace_id", body.workspaceId)
      .eq("resource_kind", body.resourceKind)
      .eq("resource_id", body.resourceId);
    const invites = await userClient
      .from("share_invitations")
      .select("id, email, role, expires_at, revoked_at, accepted_at, created_at")
      .eq("workspace_id", body.workspaceId)
      .eq("resource_kind", body.resourceKind)
      .eq("resource_id", body.resourceId);
    return json({
      ok: true,
      shares: shares.data ?? [],
      invitations: invites.data ?? []
    });
  }

  if (body.action === "revoke_share" && body.shareId) {
    const { error } = await userClient.from("resource_shares").delete().eq("id", body.shareId);
    if (error) return json({ error: error.message });
    return json({ ok: true });
  }
  if (body.action === "revoke_invite" && body.invitationId) {
    const { error } = await userClient
      .from("share_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", body.invitationId);
    if (error) return json({ error: error.message });
    return json({ ok: true });
  }
  if (body.action === "update_role" && body.shareId && body.role) {
    const { error } = await userClient.from("resource_shares").update({ role: body.role }).eq("id", body.shareId);
    if (error) return json({ error: error.message });
    return json({ ok: true });
  }
  return json({ error: "unknown_action" });
});
