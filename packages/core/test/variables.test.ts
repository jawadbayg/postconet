import { describe, expect, it } from "vitest";
import { interpolate, lookupVariable, type VariableScopes } from "../src/variables/resolve.js";
import type { Variable } from "../src/types.js";

function v(key: string, value: string): Variable {
  return { id: key, key, value, enabled: true, secret: false };
}

describe("variable precedence", () => {
  const scopes: VariableScopes = {
    global: [v("host", "global.example")],
    collection: [v("host", "collection.example"), v("path", "users")],
    environment: [v("host", "env.example")],
    data: { host: "data.example" },
    local: { token: "abc" }
  };

  it("uses local over environment over collection over global", () => {
    expect(lookupVariable("token", scopes)?.scope).toBe("local");
    expect(lookupVariable("host", scopes)?.value).toBe("data.example");
    expect(lookupVariable("path", scopes)?.value).toBe("users");
  });

  it("interpolates nested placeholders and reports missing keys", () => {
    const diagnostics = { missing: [] as string[], used: [] as Array<{ key: string; scope: "local" | "data" | "environment" | "collection" | "global" }> };
    const out = interpolate("https://{{host}}/{{path}}/{{missing}}", scopes, diagnostics);
    expect(out).toBe("https://data.example/users/{{missing}}");
    expect(diagnostics.missing).toContain("missing");
  });

  it("resolves dynamic $guid", () => {
    const out = interpolate("{{$guid}}", {});
    expect(out).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
