Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const worker = Deno.env.get("WORKER_PUBLIC_BASE_URL");
  if (!worker) {
    return new Response(JSON.stringify({ error: "Worker not configured. Cloud monitors cannot run while the desktop is closed." }), {
      status: 503,
      headers: { ...cors, "content-type": "application/json" }
    });
  }
  const body = await req.text();
  const res = await fetch(`${worker}/monitors/dispatch`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: req.headers.get("authorization") ?? "" },
    body
  });
  return new Response(await res.text(), { status: res.status, headers: { ...cors, "content-type": "application/json" } });
});
