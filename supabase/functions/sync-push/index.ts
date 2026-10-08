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
    const { data: role } = await supabase.rpc("workspace_role", { ws: op.workspaceId });
    if (!role || !["editor", "administrator", "owner"].includes(role as string)) {
      rejected.push({ idempotencyKey: op.idempotencyKey, reason: "forbidden" });
      continue;
    }
    const table = tableFor(op.entityType);
    if (!table) {
      rejected.push({ idempotencyKey: op.idempotencyKey, reason: "unknown entity" });
      continue;
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
