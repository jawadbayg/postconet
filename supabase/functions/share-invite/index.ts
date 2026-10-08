import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { cors, json } from "../_shared/cors.ts";
import { sendInviteEmail } from "../_shared/email.ts";

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
  const user = userData.user;
  if (!user?.id) return json({ error: "unauthorized" }, 401);

  const body = await req.json() as {
    workspaceId: string;
    resourceKind: "collection" | "folder" | "request";
    resourceId: string;
    email: string;
    role: "viewer" | "editor";
  };

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "invalid_email" }, 400);
  if (!["viewer", "editor"].includes(body.role)) return json({ error: "invalid_role" }, 400);
  if (!["collection", "folder", "request"].includes(body.resourceKind)) return json({ error: "invalid_resource" }, 400);

  const { data: owner } = await userClient.rpc("is_workspace_owner", { ws: body.workspaceId });
  if (!owner) return json({ error: "only_owner_can_share" }, 403);

  const name = await resourceName(admin, body.resourceKind, body.resourceId);
  if (!name) return json({ error: "resource_not_found" }, 404);

  const { data: granteeId } = await admin.rpc("lookup_user_id_by_email", { p_email: email });
  const invitedByName = (user.user_metadata?.display_name as string) || user.email || "A teammate";

  if (granteeId) {
    if (granteeId === user.id) return json({ error: "cannot_share_with_self" }, 400);
    const { error } = await admin.from("resource_shares").upsert({
      workspace_id: body.workspaceId,
      resource_kind: body.resourceKind,
      resource_id: body.resourceId,
      grantee_user_id: granteeId,
      role: body.role,
      created_by: user.id
    }, { onConflict: "resource_kind,resource_id,grantee_user_id" });
    if (error) return json({ error: error.message }, 400);
    await admin.from("notifications").insert({
      user_id: granteeId,
      kind: "share_granted",
      title: `${invitedByName} shared “${name}” with you`,
      body: `You have ${body.role} access.`,
      payload: { workspaceId: body.workspaceId, resourceKind: body.resourceKind, resourceId: body.resourceId, role: body.role }
    });
    return json({ ok: true, mode: "direct", registered: true });
  }

  const token = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await sha256(token);
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await admin.from("share_invitations").insert({
    workspace_id: body.workspaceId,
    resource_kind: body.resourceKind,
    resource_id: body.resourceId,
    resource_name: name,
    email,
    role: body.role,
    token_hash: tokenHash,
    invited_by: user.id,
    expires_at: expires
  });
  if (error) return json({ error: error.message }, 400);

  const base = Deno.env.get("APP_INVITE_URL") ?? `${url}/functions/v1/share-landing`;
  const acceptUrl = `${base}?token=${encodeURIComponent(token)}`;
  const emailResult = await sendInviteEmail({
    to: email,
    resourceName: name,
    role: body.role,
    acceptUrl,
    invitedBy: invitedByName
  });
  return json({ ok: true, mode: "invited", registered: false, email: emailResult });
});

async function resourceName(admin: ReturnType<typeof createClient>, kind: string, id: string) {
  const table = kind === "collection" ? "collections" : kind === "folder" ? "folders" : "requests";
  const { data } = await admin.from(table).select("name").eq("id", id).maybeSingle();
  return data?.name as string | undefined;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
