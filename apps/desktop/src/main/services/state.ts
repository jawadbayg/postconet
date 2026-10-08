import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { StudioRepo } from "@postconet/persistence";
import type { Database } from "@postconet/persistence";
import type { SyncState } from "@postconet/core";

export const runtime: {
  user: User | null;
  supabase: SupabaseClient | null;
  db: Database | null;
  repo: StudioRepo | null;
  accountId: string;
  sync: SyncState;
  syncError: string | null;
  lastHydration: { phase: string; detail?: string } | null;
  abort: Map<string, AbortController>;
  onLocalMutation: (() => void) | null;
} = {
  user: null,
  supabase: null,
  db: null,
  repo: null,
  accountId: "local",
  sync: "offline",
  syncError: null,
  lastHydration: null,
  abort: new Map(),
  onLocalMutation: null
};
