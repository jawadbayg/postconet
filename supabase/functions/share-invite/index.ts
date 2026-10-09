import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { cors, json } from "../_shared/cors.ts";
// v1: in-app users only. Do not send SMTP / Resend.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
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

    const body = (await req.json()) as {
      workspaceId: string;
      resourceKind: "collection" | "folder" | "request";
      resourceId: string;
      email: string;
      role: "viewer" | "editor";
    };

    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "invalid_email" });
    if (!["viewer", "editor"].includes(body.role)) return json({ error: "invalid_role" });
    if (!["collection", "folder", "request"].includes(body.resourceKind)) return json({ error: "invalid_resource" });

    const { data: owner } = await userClient.rpc("is_workspace_owner", { ws: body.workspaceId });
    if (!owner) return json({ error: "only_owner_can_share" });

    const name = await resourceName(admin, body.resourceKind, body.resourceId);
    if (!name) return json({ error: "resource_not_found" });

    const granteeId = await findUserIdByEmail(admin, url, service, email);
    const invitedByName = (user.user_metadata?.display_name as string) || user.email || "A teammate";

    if (!granteeId) return json({ error: "user_not_found" });
    if (granteeId === user.id) return json({ error: "cannot_share_with_self" });

    await admin.from("profiles").upsert(
      { id: granteeId, display_name: email.split("@")[0] ?? email },
      { onConflict: "id", ignoreDuplicates: true }
    );

    const { error } = await admin.from("resource_shares").upsert(
      {
        workspace_id: body.workspaceId,
        resource_kind: body.resourceKind,
        resource_id: body.resourceId,
        grantee_user_id: granteeId,
        role: body.role,
        created_by: user.id
      },
      { onConflict: "resource_kind,resource_id,grantee_user_id" }
    );
    if (error) return json({ error: error.message });

    const { error: notifyError } = await admin.from("notifications").insert({
      user_id: granteeId,
      kind: "share_granted",
      title: `${invitedByName} shared “${name}” with you`,
      body: `You have ${body.role} access.`,
      payload: { workspaceId: body.workspaceId, resourceKind: body.resourceKind, resourceId: body.resourceId, role: body.role }
    });
    if (notifyError) console.error("share notification failed", notifyError.message);

    return json({ ok: true, mode: "direct", registered: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message || "share_failed" });
  }
});

async function findUserIdByEmail(
  admin: ReturnType<typeof createClient>,
  url: string,
  service: string,
  email: string
) {
  const { data } = await admin.rpc("lookup_user_id_by_email", { p_email: email });
  if (data) return data as string;

  const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${service}`, apikey: service }
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as { users?: Array<{ id?: string; email?: string }> } | Array<{ id?: string; email?: string }>;
  const users = Array.isArray(payload) ? payload : payload.users ?? [];
  return users.find((u) => String(u.email ?? "").toLowerCase() === email)?.id ?? null;
}

async function resourceName(admin: ReturnType<typeof createClient>, kind: string, id: string) {
  const table = kind === "collection" ? "collections" : kind === "folder" ? "folders" : "requests";
  const { data } = await admin.from(table).select("name").eq("id", id).maybeSingle();
  return data?.name as string | undefined;
}
