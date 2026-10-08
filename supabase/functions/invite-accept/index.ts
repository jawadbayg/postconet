import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization");
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth ?? "" } }
  });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return new Response("unauthorized", { status: 401, headers: cors });
  const { tokenHash } = await req.json() as { tokenHash: string };
  const { data: invite, error } = await supabase.from("invitations").select("*").eq("token_hash", tokenHash).maybeSingle();
  if (error || !invite) return new Response("not found", { status: 404, headers: cors });
  if (invite.revoked_at) return new Response("revoked", { status: 403, headers: cors });
  if (new Date(invite.expires_at).getTime() < Date.now()) return new Response("expired", { status: 410, headers: cors });
  if (invite.email.toLowerCase() !== (userData.user.email ?? "").toLowerCase()) {
    return new Response("email mismatch", { status: 403, headers: cors });
  }
  await supabase.from("memberships").upsert({
    organization_id: invite.organization_id,
    user_id: userData.user.id,
    role: invite.role
  });
  await supabase.from("invitations").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id);
  return new Response(JSON.stringify({ ok: true, organizationId: invite.organization_id }), {
    headers: { ...cors, "content-type": "application/json" }
  });
});
