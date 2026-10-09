import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { cors, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return json({ error: "server_misconfigured" }, 500);

  let body: { email?: string; password?: string; displayName?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string; displayName?: string };
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const displayName = String(body.displayName ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "invalid_email" }, 400);
  if (password.length < 6 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return json({ error: "password_invalid" }, 400);
  }
  if (!displayName || displayName.length > 80) return json({ error: "invalid_name" }, 400);

  const admin = createClient(url, service);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName }
  });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("already") || message.includes("registered") || message.includes("exists")) {
      return json({ error: "email_taken" }, 409);
    }
    return json({ error: error.message }, 400);
  }
  const user = data.user;
  if (!user) return json({ error: "create_failed" }, 500);
  return json({ ok: true, user: { id: user.id, email: user.email } });
});
