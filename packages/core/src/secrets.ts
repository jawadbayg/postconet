export function maskValue(value: string, visible = 0): string {
  if (!value) return "";
  if (visible <= 0) return "•".repeat(Math.min(12, Math.max(4, value.length)));
  if (value.length <= visible) return "•".repeat(value.length);
  return `${value.slice(0, visible)}${"•".repeat(8)}`;
}

export function isSecretKey(key: string): boolean {
  return /(password|secret|token|key|authorization|cookie|passwd|api[_-]?key)/i.test(key);
}

export function redactObject(input: unknown, extraSecrets: string[] = []): unknown {
  if (typeof input === "string") {
    let out = input;
    for (const secret of extraSecrets) {
      if (secret) out = out.split(secret).join("••••••••");
    }
    return out;
  }
  if (Array.isArray(input)) return input.map((item) => redactObject(item, extraSecrets));
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (isSecretKey(key) && typeof value === "string") out[key] = maskValue(value);
      else out[key] = redactObject(value, extraSecrets);
    }
    return out;
  }
  return input;
}

export function collectSecretStrings(vars: Array<{ key: string; value: string; secret?: boolean }>): string[] {
  return vars.filter((item) => item.secret || isSecretKey(item.key)).map((item) => item.value).filter(Boolean);
}
