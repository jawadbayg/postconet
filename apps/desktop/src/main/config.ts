import { brand } from "@postconet/core";

export function supabaseUrl(): string {
  return import.meta.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
}

export function supabaseAnonKey(): string {
  return import.meta.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
}

export function workerUrl(): string {
  return import.meta.env.VITE_WORKER_URL || process.env.VITE_WORKER_URL || "";
}

export function isCloudConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey());
}

export const appBrand = brand;
