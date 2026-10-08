import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { cors, json } from "../_shared/cors.ts";

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
  if (!user?.id || !user.email) return json({ error: "unauthorized" }, 401);
  if (!user.email_confirmed_at) return json({ error: "email_unverified" }, 403);

  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const email = user.email.toLowerCase();
  let query = admin.from("share_invitations").select("*").is("revoked_at", null).is("accepted_at", null).gt("expires_at", new Date().toISOString());
  if (body.token) {
    const tokenHash = await sha256(body.token);
    query = admin.from("share_invitations").select("*").eq("token_hash", tokenHash);
  } else {
    query = admin.from("share_invitations").select("*").eq("email", email).is("revoked_at", null).is("accepted_at", null).gt("expires_at", new Date().toISOString());
  }
  const { data: invites, error } = await query;
  if (error) return json({ error: error.message }, 400);

  const now = Date.now();
  const accepted: string[] = [];
  for (const invite of invites ?? []) {
    if (String(invite.email).toLowerCase() !== email) continue;
    if (invite.revoked_at) continue;
    if (invite.accepted_at) continue;
    if (new Date(invite.expires_at).getTime() < now) continue;
    await admin.from("resource_shares").upsert({
      workspace_id: invite.workspace_id,
      resource_kind: invite.resource_kind,
      resource_id: invite.resource_id,
      grantee_user_id: user.id,
      role: invite.role,
      created_by: invite.invited_by
    }, { onConflict: "resource_kind,resource_id,grantee_user_id" });
    await admin.from("share_invitations").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id);
    await admin.from("notifications").insert({
      user_id: user.id,
      kind: "share_accepted",
      title: `You now have ${invite.role} access to “${invite.resource_name}”`,
      payload: { workspaceId: invite.workspace_id, resourceKind: invite.resource_kind, resourceId: invite.resource_id }
    });
    accepted.push(invite.id);
  }
  if (body.token && accepted.length === 0) {
    return json({ error: "invalid_expired_or_email_mismatch" }, 400);
  }
  return json({ ok: true, accepted: accepted.length });
});

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
