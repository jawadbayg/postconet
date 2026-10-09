import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey"
};

type Decision = "apply" | "conflict" | "deleted" | "already_deleted";

function evaluatePush(
  current: { version: number; deletedAt?: string | null } | null,
  op: { op: "upsert" | "delete"; version: number; baseVersion?: number | null }
): Decision {
  const base = op.baseVersion ?? Math.max(0, Number(op.version) - 1);
  if (!current) {
    if (op.op === "delete") return "already_deleted";
    return "apply";
  }
  if (current.deletedAt) {
    if (op.op === "delete") return "already_deleted";
    return "deleted";
  }
  if (Number(current.version) !== Number(base)) return "conflict";
  return "apply";
}

const PG_INT_MAX = 2_147_483_647;

function cloudSortOrder(value: unknown): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n <= PG_INT_MAX) return n;
  return Math.min(PG_INT_MAX, Math.trunc(n / 1000));
}

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
      baseVersion?: number | null;
      payload: unknown;
    }>;
  };

  const applied: Array<{ idempotencyKey: string; seq: number; version: number }> = [];
  const rejected: Array<{
    idempotencyKey: string;
    reason: string;
    currentVersion?: number;
    current?: unknown;
    deleted?: boolean;
  }> = [];

  for (const op of body.ops ?? []) {
    const table = tableFor(op.entityType);
    if (!table) {
      rejected.push({ idempotencyKey: op.idempotencyKey, reason: "unknown entity" });
      continue;
    }
    const allowed = await canEdit(supabase, op);
    if (!allowed) {
      rejected.push({ idempotencyKey: op.idempotencyKey, reason: "forbidden" });
      continue;
    }

    const { data: existingLog } = await supabase
      .from("change_log")
      .select("seq, version")
      .eq("idempotency_key", op.idempotencyKey)
      .maybeSingle();
    if (existingLog) {
      applied.push({ idempotencyKey: op.idempotencyKey, seq: existingLog.seq, version: existingLog.version });
      continue;
    }

    const current = await loadCurrent(supabase, table, op);
    const decision = evaluatePush(current, op);
    if (decision === "already_deleted") {
      applied.push({ idempotencyKey: op.idempotencyKey, seq: 0, version: op.version });
      continue;
    }
    if (decision !== "apply") {
      rejected.push({
        idempotencyKey: op.idempotencyKey,
        reason: decision,
        currentVersion: current?.version,
        current: current?.payload ?? null,
        deleted: Boolean(current?.deletedAt) || decision === "deleted"
      });
      continue;
    }

    const wrote = await writeEntity(supabase, table, op, current);
    if (!wrote.ok) {
      const latest = await loadCurrent(supabase, table, op);
      rejected.push({
        idempotencyKey: op.idempotencyKey,
        reason: wrote.reason ? `write_failed:${wrote.reason}` : latest?.deletedAt ? "deleted" : "conflict",
        currentVersion: latest?.version,
        current: latest?.payload ?? null,
        deleted: Boolean(latest?.deletedAt)
      });
      continue;
    }

    const { error: logErr, data: logRow } = await supabase
      .from("change_log")
      .insert({
        workspace_id: op.workspaceId,
        entity_type: op.entityType,
        entity_id: op.entityId,
        op: op.op,
        version: op.version,
        payload: op.payload,
        actor_id: userData.user.id,
        idempotency_key: op.idempotencyKey
      })
      .select("seq, version")
      .single();
    if (logErr) {
      const { data: again } = await supabase.from("change_log").select("seq, version").eq("idempotency_key", op.idempotencyKey).maybeSingle();
      if (again) applied.push({ idempotencyKey: op.idempotencyKey, seq: again.seq, version: again.version });
      else rejected.push({ idempotencyKey: op.idempotencyKey, reason: logErr.message });
      continue;
    }
    await supabase.from("revisions").insert({
      workspace_id: op.workspaceId,
      entity_type: op.entityType,
      entity_id: op.entityId,
      version: op.version,
      payload: op.payload,
      actor_id: userData.user.id
    });
    if (logRow) applied.push({ idempotencyKey: op.idempotencyKey, seq: logRow.seq, version: logRow.version });
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

async function canEdit(
  supabase: ReturnType<typeof createClient>,
  op: { entityType: string; entityId: string; workspaceId: string; payload: unknown }
) {
  if (op.entityType === "collection" || op.entityType === "folder" || op.entityType === "request") {
    const payload = op.payload as Record<string, unknown>;
    const { data: direct } = await supabase.rpc("can_edit_resource", {
      p_kind: op.entityType,
      p_id: op.entityId,
      p_workspace: op.workspaceId
    });
    let allowed = Boolean(direct);
    if (!allowed && op.entityType !== "collection") {
      const collectionId = (payload.collectionId ?? payload.collection_id) as string | undefined;
      if (collectionId) {
        const { data: colEdit } = await supabase.rpc("can_edit_resource", {
          p_kind: "collection",
          p_id: collectionId,
          p_workspace: op.workspaceId
        });
        allowed = Boolean(colEdit);
      }
      const folderId = (payload.folderId ?? payload.folder_id) as string | undefined;
      if (!allowed && folderId) {
        const { data: folderEdit } = await supabase.rpc("can_edit_resource", {
          p_kind: "folder",
          p_id: folderId,
          p_workspace: op.workspaceId
        });
        allowed = Boolean(folderEdit);
      }
    }
    if (allowed) return true;
  }
  const { data: role } = await supabase.rpc("workspace_role", { ws: op.workspaceId });
  return Boolean(role && ["editor", "administrator", "owner"].includes(role as string));
}

async function loadCurrent(
  supabase: ReturnType<typeof createClient>,
  table: string,
  op: { entityId: string; workspaceId: string }
) {
  if (table === "globals") {
    const { data } = await supabase.from("globals").select("version, payload").eq("workspace_id", op.workspaceId).maybeSingle();
    return data ? { version: Number(data.version), deletedAt: null as string | null, payload: data.payload } : null;
  }
  const { data } = await supabase.from(table).select("version, deleted_at, payload").eq("id", op.entityId).maybeSingle();
  return data
    ? { version: Number(data.version), deletedAt: (data.deleted_at as string | null) ?? null, payload: data.payload }
    : null;
}

async function writeEntity(
  supabase: ReturnType<typeof createClient>,
  table: string,
  op: { entityId: string; workspaceId: string; version: number; baseVersion?: number | null; op: "upsert" | "delete"; payload: unknown },
  current: { version: number } | null
): Promise<{ ok: boolean; reason?: string }> {
  const base = op.baseVersion ?? Math.max(0, Number(op.version) - 1);
  const now = new Date().toISOString();
  if (table === "globals") {
    if (!current) {
      const { error } = await supabase.from("globals").insert({ workspace_id: op.workspaceId, payload: op.payload, version: op.version, updated_at: now });
      return { ok: !error, reason: error?.message };
    }
    const { data, error } = await supabase
      .from("globals")
      .update({ payload: op.payload, version: op.version, updated_at: now })
      .eq("workspace_id", op.workspaceId)
      .eq("version", base)
      .select("workspace_id");
    return { ok: !error && Boolean(data?.length), reason: error?.message };
  }
  if (op.op === "delete") {
    const { data, error } = await supabase
      .from(table)
      .update({ deleted_at: now, version: op.version, updated_at: now })
      .eq("id", op.entityId)
      .eq("version", base)
      .is("deleted_at", null)
      .select("id");
    return { ok: !error && Boolean(data?.length), reason: error?.message };
  }
  if (!current) {
    const { error } = await supabase.from(table).insert(payloadRow(op, table));
    return { ok: !error, reason: error?.message };
  }
  const { data, error } = await supabase
    .from(table)
    .update(payloadRow(op, table))
    .eq("id", op.entityId)
    .eq("version", base)
    .is("deleted_at", null)
    .select("id");
  return { ok: !error && Boolean(data?.length), reason: error?.message };
}

function payloadRow(op: { entityId: string; workspaceId: string; version: number; payload: unknown }, table: string) {
  const p = op.payload as Record<string, unknown>;
  const row: Record<string, unknown> = {
    id: op.entityId,
    workspace_id: op.workspaceId,
    name: p.name ?? "Untitled",
    version: op.version,
    updated_at: new Date().toISOString(),
    created_at: p.createdAt ?? new Date().toISOString(),
    payload: op.payload,
    deleted_at: p.deletedAt ?? null
  };
  if (p.kind) row.kind = p.kind;
  if (p.ownerUserId) row.owner_user_id = p.ownerUserId;
  if (p.organizationId) row.organization_id = p.organizationId;
  if (table === "folders") {
    row.collection_id = p.collectionId ?? p.collection_id ?? null;
    row.parent_id = p.parentId !== undefined ? p.parentId : p.parent_id ?? null;
    row.sort_order = cloudSortOrder(p.sortOrder ?? p.sort_order);
  }
  if (table === "requests") {
    row.collection_id = p.collectionId ?? p.collection_id ?? null;
    row.folder_id = p.folderId !== undefined ? p.folderId : p.folder_id ?? null;
    row.project_id = p.projectId !== undefined ? p.projectId : p.project_id ?? null;
    row.protocol = p.protocol ?? "http";
    row.favorite = Boolean(p.favorite);
    row.sort_order = cloudSortOrder(p.sortOrder ?? p.sort_order);
  }
  if (table === "projects" && p.sortOrder !== undefined) row.sort_order = cloudSortOrder(p.sortOrder);
  return row;
}
