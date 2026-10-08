import { cors } from "../_shared/cors.ts";

Deno.serve((req) => {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const deep = `postconet://invite?token=${encodeURIComponent(token)}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>PostConet invitation</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;background:#f4f5f7;color:#12151a;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
  main{background:#fff;border:1px solid #e2e5ea;border-radius:12px;padding:28px;max-width:420px}
  a{display:inline-block;margin-top:16px;background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none}
  p{color:#667085;line-height:1.5}
</style></head>
<body><main>
  <h1 style="margin:0 0 8px;font-size:22px">You were invited to PostConet</h1>
  <p>Open the desktop app and sign in with the same email this invitation was sent to. Verify your inbox if asked. Access is granted only after that address is confirmed.</p>
  <a href="${deep}">Open PostConet</a>
  <p style="font-size:13px">If the app does not open, launch PostConet API Studio and sign in. Pending invitations are accepted automatically after verification.</p>
</main>
<script>if (${JSON.stringify(Boolean(token))}) { location.href = ${JSON.stringify(deep)}; }</script>
</body></html>`;
  return new Response(html, { headers: { ...cors, "content-type": "text/html; charset=utf-8" } });
});
