import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization");
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth ?? "" } }
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user) return new Response("unauthorized", { status: 401, headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: owned } = await admin.from("memberships").select("organization_id, role").eq("user_id", userData.user.id).eq("role", "owner");
  for (const row of owned ?? []) {
    const { count } = await admin.from("memberships").select("*", { count: "exact", head: true }).eq("organization_id", row.organization_id);
    if ((count ?? 0) > 1) {
      return new Response(JSON.stringify({ error: "Transfer or delete organizations you own before deleting your account." }), {
        status: 409,
        headers: { ...cors, "content-type": "application/json" }
      });
    }
    await admin.from("organizations").delete().eq("id", row.organization_id);
  }
  await admin.from("workspaces").delete().eq("owner_user_id", userData.user.id);
  await admin.auth.admin.deleteUser(userData.user.id);
  return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "content-type": "application/json" } });
});
