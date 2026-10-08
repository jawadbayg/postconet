import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization");
  if (!auth) return new Response("unauthorized", { status: 401, headers: cors });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }
  });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return new Response("unauthorized", { status: 401, headers: cors });
  const { workspaceId, afterSeq } = await req.json() as { workspaceId: string; afterSeq: number };
  const { data: role } = await supabase.rpc("workspace_role", { ws: workspaceId });
  const { data: shared } = await supabase.rpc("has_resource_share", { ws: workspaceId });
  if (!role && !shared) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: cors });
  const { data, error } = await supabase
    .from("change_log")
    .select("*")
    .eq("workspace_id", workspaceId)
    .gt("seq", afterSeq ?? 0)
    .order("seq", { ascending: true })
    .limit(500);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: cors });
  return new Response(JSON.stringify({ changes: data ?? [] }), { headers: { ...cors, "content-type": "application/json" } });
});
