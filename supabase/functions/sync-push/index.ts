import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization");
  if (!auth) return new Response("unauthorized", { status: 401, headers: cors });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return new Response("unauthorized", { status: 401, headers: cors });

  const body = await req.json() as {
    ops: Array<{
      idempotencyKey: string;
      workspaceId: string;
      entityType: string;
      entityId: string;
      op: "upsert" | "delete";
      version: number;
      payload: unknown;
    }>;
  };

  const applied: Array<{ idempotencyKey: string; seq: number; version: number }> = [];
  const rejected: Array<{ idempotencyKey: string; reason: string }> = [];

  for (const op of body.ops ?? []) {
    const table = tableFor(op.entityType);
    if (!table) {
      rejected.push({ idempotencyKey: op.idempotencyKey, reason: "unknown entity" });
      continue;
    }
    if (op.entityType === "collection" || op.entityType === "folder" || op.entityType === "request") {
      const payload = op.payload as Record<string, unknown>;
      const { data: direct } = await supabase.rpc("can_edit_resource", {
        p_kind: op.entityType,
        p_id: op.entityId,
        p_workspace: op.workspaceId
      });
      let allowed = Boolean(direct);
      if (!allowed && op.entityType !== "collection") {
        const collectionId = payload.collectionId as string | undefined;
        if (collectionId) {
          const { data: colEdit } = await supabase.rpc("can_edit_resource", {
            p_kind: "collection",
            p_id: collectionId,
            p_workspace: op.workspaceId
          });
          allowed = Boolean(colEdit);
        }
        const folderId = payload.folderId as string | undefined;
        if (!allowed && folderId) {
          const { data: folderEdit } = await supabase.rpc("can_edit_resource", {
            p_kind: "folder",
            p_id: folderId,
            p_workspace: op.workspaceId
          });
          allowed = Boolean(folderEdit);
        }
      }
      if (!allowed) {
        const { data: role } = await supabase.rpc("workspace_role", { ws: op.workspaceId });
        if (!role || !["editor", "administrator", "owner"].includes(role as string)) {
          rejected.push({ idempotencyKey: op.idempotencyKey, reason: "forbidden" });
          continue;
        }
      }
    } else {
      const { data: role } = await supabase.rpc("workspace_role", { ws: op.workspaceId });
      if (!role || !["editor", "administrator", "owner"].includes(role as string)) {
        rejected.push({ idempotencyKey: op.idempotencyKey, reason: "forbidden" });
        continue;
      }
    }
    if (table !== "globals") {
      const { data: current } = await supabase.from(table).select("version").eq("id", op.entityId).maybeSingle();
      if (current && Number(current.version) > Number(op.version)) {
        rejected.push({ idempotencyKey: op.idempotencyKey, reason: "conflict", currentVersion: current.version });
        continue;
      }
    }
    const { error: dup } = await supabase.from("change_log").insert({
      workspace_id: op.workspaceId,
      entity_type: op.entityType,
      entity_id: op.entityId,
      op: op.op,
      version: op.version,
      payload: op.payload,
      actor_id: userData.user.id,
      idempotency_key: op.idempotencyKey
    });
    if (dup) {
      const { data: existing } = await supabase.from("change_log").select("seq, version").eq("idempotency_key", op.idempotencyKey).single();
      if (existing) applied.push({ idempotencyKey: op.idempotencyKey, seq: existing.seq, version: existing.version });
      else rejected.push({ idempotencyKey: op.idempotencyKey, reason: dup.message });
      continue;
    }
    if (op.op === "delete") {
      await supabase.from(table).update({ deleted_at: new Date().toISOString(), version: op.version }).eq("id", op.entityId);
    } else if (table === "globals") {
      await supabase.from("globals").upsert({ workspace_id: op.workspaceId, payload: op.payload, version: op.version });
    } else {
      await supabase.from(table).upsert(payloadRow(op));
    }
    const { data: row } = await supabase.from("change_log").select("seq, version").eq("idempotency_key", op.idempotencyKey).single();
    if (row) applied.push({ idempotencyKey: op.idempotencyKey, seq: row.seq, version: row.version });
  }

  return new Response(JSON.stringify({ applied, rejected }), { headers: { ...cors, "content-type": "application/json" } });
});

function tableFor(t: string): string | null {
  const map: Record<string, string> = {
    workspace: "workspaces",
    project: "projects",
    collection: "collections",
    folder: "folders",
    request: "requests",
    environment: "environments",
    globals: "globals"
  };
  return map[t] ?? null;
}

function payloadRow(op: { entityId: string; workspaceId: string; version: number; payload: unknown }) {
  const p = op.payload as Record<string, unknown>;
  return {
    id: op.entityId,
    workspace_id: op.workspaceId,
    name: p.name ?? "Untitled",
    version: op.version,
    updated_at: new Date().toISOString(),
    created_at: p.createdAt ?? new Date().toISOString(),
    payload: op.payload,
    ...(p.collectionId ? { collection_id: p.collectionId } : {}),
    ...(p.folderId !== undefined ? { folder_id: p.folderId } : {}),
    ...(p.protocol ? { protocol: p.protocol } : {}),
    ...(p.kind ? { kind: p.kind } : {}),
    ...(p.ownerUserId ? { owner_user_id: p.ownerUserId } : {}),
    ...(p.organizationId ? { organization_id: p.organizationId } : {})
  };
}
