import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { cors, json } from "../_shared/cors.ts";
// v1: in-app users only. Do not send SMTP / Resend.

type ResourceKind = "workspace" | "collection" | "folder" | "request";

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
      resourceKind: ResourceKind;
      resourceId?: string;
      email: string;
      role: "viewer" | "editor";
    };

    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "invalid_email" });
    if (!["viewer", "editor"].includes(body.role)) return json({ error: "invalid_role" });
    if (!["workspace", "collection", "folder", "request"].includes(body.resourceKind)) {
      return json({ error: "invalid_resource" });
    }

    const { data: owner } = await userClient.rpc("is_workspace_owner", { ws: body.workspaceId });
    if (!owner) return json({ error: "only_owner_can_share" });

    const resourceId = body.resourceKind === "workspace" ? body.workspaceId : String(body.resourceId ?? "");
    const meta = await resourceMeta(admin, body.resourceKind, resourceId, body.workspaceId);
    if (!meta?.name) return json({ error: "resource_not_found" });

    const granteeId = await findUserIdByEmail(admin, url, service, email);
    const invitedByName = (user.user_metadata?.display_name as string) || user.email?.split("@")[0] || "A teammate";

    if (!granteeId) return json({ error: "user_not_found" });
    if (granteeId === user.id) return json({ error: "cannot_share_with_self" });

    await admin.from("profiles").upsert(
      { id: granteeId, display_name: email.split("@")[0] ?? email },
      { onConflict: "id", ignoreDuplicates: true }
    );

    if (body.resourceKind === "workspace") {
      const { error } = await admin.from("workspace_members").upsert(
        { workspace_id: body.workspaceId, user_id: granteeId, role: body.role },
        { onConflict: "workspace_id,user_id" }
      );
      if (error) return json({ error: error.message });
    } else {
      const { error } = await admin.from("resource_shares").upsert(
        {
          workspace_id: body.workspaceId,
          resource_kind: body.resourceKind,
          resource_id: resourceId,
          grantee_user_id: granteeId,
          role: body.role,
          created_by: user.id
        },
        { onConflict: "resource_kind,resource_id,grantee_user_id" }
      );
      if (error) return json({ error: error.message });
    }

    const copy = notifyCopy({
      invitedByName,
      kind: body.resourceKind,
      name: meta.name,
      role: body.role
    });
    const { error: notifyError } = await admin.from("notifications").insert({
      user_id: granteeId,
      kind: body.resourceKind === "workspace" ? "workspace_invite" : "share_granted",
      title: copy.title,
      body: copy.body,
      payload: {
        workspaceId: body.workspaceId,
        resourceKind: body.resourceKind,
        resourceId,
        collectionId: meta.collectionId ?? null,
        folderId: meta.folderId ?? null,
        role: body.role,
        name: meta.name,
        ownerLabel: invitedByName
      }
    });
    if (notifyError) console.error("share notification failed", notifyError.message);

    return json({ ok: true, mode: "direct", registered: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message || "share_failed" });
  }
});

function kindLabel(kind: ResourceKind) {
  if (kind === "request") return "API";
  if (kind === "workspace") return "workspace";
  return kind;
}

function notifyCopy(opts: { invitedByName: string; kind: ResourceKind; name: string; role: "viewer" | "editor" }) {
  const roleLine = opts.role === "editor" ? "You can view and edit it." : "You can view it, but you cannot edit it.";
  const switcher = `Shared · ${opts.invitedByName}`;
  if (opts.kind === "workspace") {
    return {
      title: `${opts.invitedByName} invited you to “${opts.name}”`,
      body: `They shared their whole workspace with you as ${opts.role}. Open the workspace menu at the top and choose “${switcher}”. You’ll see every collection, folder, and API there. ${roleLine}`
    };
  }
  const item = kindLabel(opts.kind);
  return {
    title: `${opts.invitedByName} shared the ${item} “${opts.name}” with you`,
    body: `Open the workspace menu at the top, choose “${switcher}”, then look in the sidebar for that ${item}. ${roleLine}`
  };
}

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

async function resourceMeta(
  admin: ReturnType<typeof createClient>,
  kind: ResourceKind,
  id: string,
  workspaceId: string
) {
  if (kind === "workspace") {
    const { data } = await admin.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
    return { name: (data?.name as string | undefined) ?? "Personal", collectionId: null as string | null, folderId: null as string | null };
  }
  if (kind === "collection") {
    const { data } = await admin.from("collections").select("name").eq("id", id).maybeSingle();
    if (!data) return null;
    return { name: data.name as string, collectionId: id, folderId: null };
  }
  if (kind === "folder") {
    const { data } = await admin.from("folders").select("name, collection_id").eq("id", id).maybeSingle();
    if (!data) return null;
    return { name: data.name as string, collectionId: (data.collection_id as string | null) ?? null, folderId: id };
  }
  const { data } = await admin.from("requests").select("name, collection_id, folder_id").eq("id", id).maybeSingle();
  if (!data) return null;
  return {
    name: data.name as string,
    collectionId: (data.collection_id as string | null) ?? null,
    folderId: (data.folder_id as string | null) ?? null
  };
}
