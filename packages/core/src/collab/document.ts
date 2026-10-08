import * as Y from "yjs";

export type CollabTextFields = {
  url?: string;
  body?: string;
  prerequest?: string;
  test?: string;
  description?: string;
  name?: string;
};

export function createRequestDoc(initial?: CollabTextFields): Y.Doc {
  const doc = new Y.Doc();
  const map = doc.getMap("fields");
  if (initial) {
    doc.transact(() => {
      for (const [k, v] of Object.entries(initial)) {
        if (v != null) {
          const text = new Y.Text();
          text.insert(0, v);
          map.set(k, text);
        }
      }
    });
  }
  return doc;
}

export function applyUpdate(doc: Y.Doc, update: Uint8Array) {
  Y.applyUpdate(doc, update);
}

export function encodeState(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

export function readFields(doc: Y.Doc): CollabTextFields {
  const map = doc.getMap("fields");
  const out: CollabTextFields = {};
  map.forEach((value, key) => {
    if (value instanceof Y.Text) (out as Record<string, string>)[key] = value.toString();
  });
  return out;
}

export function setField(doc: Y.Doc, key: keyof CollabTextFields, value: string) {
  const map = doc.getMap("fields");
  doc.transact(() => {
    let text = map.get(key as string);
    if (!(text instanceof Y.Text)) {
      text = new Y.Text();
      map.set(key as string, text);
    }
    const ytext = text as Y.Text;
    const current = ytext.toString();
    if (current === value) return;
    ytext.delete(0, current.length);
    ytext.insert(0, value);
  });
}

export type StructuredConflict = {
  field: string;
  local: unknown;
  remote: unknown;
  localVersion: number;
  remoteVersion: number;
};

export function mergeStructured(
  local: Record<string, unknown> & { version: number },
  remote: Record<string, unknown> & { version: number },
  lwwKeys: string[]
): { merged: Record<string, unknown>; conflicts: StructuredConflict[] } {
  if (remote.version > local.version) {
    return { merged: { ...local, ...remote }, conflicts: [] };
  }
  if (local.version > remote.version) {
    return { merged: { ...remote, ...local }, conflicts: [] };
  }
  const conflicts: StructuredConflict[] = [];
  const merged = { ...local };
  for (const key of lwwKeys) {
    if (JSON.stringify(local[key]) !== JSON.stringify(remote[key])) {
      conflicts.push({
        field: key,
        local: local[key],
        remote: remote[key],
        localVersion: local.version,
        remoteVersion: remote.version
      });
    }
  }
  return { merged, conflicts };
}
