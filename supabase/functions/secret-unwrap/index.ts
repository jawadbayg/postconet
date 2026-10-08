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
  const { secretId } = await req.json() as { secretId: string };
  const { data: secret } = await supabase.from("shared_secrets").select("*").eq("id", secretId).maybeSingle();
  if (!secret) return new Response("not found", { status: 404, headers: cors });
  const { data: role } = await supabase.rpc("workspace_role", { ws: secret.workspace_id });
  if (!role || !["editor", "administrator", "owner"].includes(role as string)) {
    return new Response("forbidden", { status: 403, headers: cors });
  }
  return new Response(JSON.stringify({
    id: secret.id,
    name: secret.name,
    ciphertext: secret.ciphertext,
    note: "Server-side encryption at rest. Not end-to-end. Administrators with function secrets can decrypt."
  }), { headers: { ...cors, "content-type": "application/json" } });
});
