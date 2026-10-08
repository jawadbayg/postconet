import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const collectionId = url.searchParams.get("collectionId");
  if (!collectionId) return new Response("missing collectionId", { status: 400, headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: col } = await admin.from("collections").select("*").eq("id", collectionId).maybeSingle();
  if (!col) return new Response("not found", { status: 404, headers: cors });
  const published = (col.payload as { publicDocs?: boolean }).publicDocs;
  if (!published) return new Response("not published", { status: 404, headers: cors });
  const { data: requests } = await admin.from("requests").select("name, protocol, payload").eq("collection_id", collectionId).is("deleted_at", null);
  const redacted = (requests ?? []).map((r) => ({
    name: r.name,
    protocol: r.protocol,
    url: redact((r.payload as { document?: { url?: string } }).document?.url ?? ""),
    method: (r.payload as { document?: { method?: string } }).document?.method
  }));
  return new Response(JSON.stringify({ name: col.name, requests: redacted }), { headers: { ...cors, "content-type": "application/json" } });
});

function redact(s: string) {
  return s.replace(/\/\/([^@]+)@/, "//••••@");
}
