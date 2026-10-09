import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { cors, json } from "../_shared/cors.ts";

type ResourceKind = "workspace" | "collection" | "folder" | "request";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, service);
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user) return json({ error: "unauthorized" }, 401);

  const body = await req.json() as {
    action: "list" | "revoke_share" | "revoke_invite" | "update_role";
    workspaceId: string;
    resourceKind?: ResourceKind;
    resourceId?: string;
    shareId?: string;
    invitationId?: string;
    role?: "viewer" | "editor";
  };

  const { data: owner } = await userClient.rpc("is_workspace_owner", { ws: body.workspaceId });
  if (!owner && body.action !== "list") return json({ error: "forbidden" });

  if (body.action === "list") {
    if (body.resourceKind === "workspace") {
      const members = await userClient.from("workspace_members").select("user_id, role").eq("workspace_id", body.workspaceId);
      const shares = await Promise.all(
        (members.data ?? []).map(async (row) => {
          const member = row as { user_id: string; role: string };
          return {
            id: member.user_id,
            grantee_user_id: member.user_id,
            role: member.role,
            email: await emailFor(admin, member.user_id),
            display_name: await displayNameFor(userClient, member.user_id)
          };
        })
      );
      return json({ ok: true, shares, invitations: [] });
    }
    const sharesRes = await userClient
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
    const shares = await Promise.all(
      (sharesRes.data ?? []).map(async (row) => {
        const share = row as { id: string; grantee_user_id: string; role: string; created_at: string };
        return {
          ...share,
          email: await emailFor(admin, share.grantee_user_id),
          display_name: await displayNameFor(userClient, share.grantee_user_id)
        };
      })
    );
    return json({
      ok: true,
      shares,
      invitations: invites.data ?? []
    });
  }

  if (body.action === "revoke_share" && body.shareId) {
    if (body.resourceKind === "workspace") {
      const { error } = await userClient
        .from("workspace_members")
        .delete()
        .eq("workspace_id", body.workspaceId)
        .eq("user_id", body.shareId);
      if (error) return json({ error: error.message });
      return json({ ok: true });
    }
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
    if (body.resourceKind === "workspace") {
      const { error } = await userClient
        .from("workspace_members")
        .update({ role: body.role })
        .eq("workspace_id", body.workspaceId)
        .eq("user_id", body.shareId);
      if (error) return json({ error: error.message });
      return json({ ok: true });
    }
    const { error } = await userClient.from("resource_shares").update({ role: body.role }).eq("id", body.shareId);
    if (error) return json({ error: error.message });
    return json({ ok: true });
  }
  return json({ error: "unknown_action" });
});

async function displayNameFor(userClient: ReturnType<typeof createClient>, userId: string) {
  const { data } = await userClient.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  return (data?.display_name as string | undefined) ?? "";
}

async function emailFor(admin: ReturnType<typeof createClient>, userId: string) {
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    return data.user?.email ?? "";
  } catch {
    return "";
  }
}
