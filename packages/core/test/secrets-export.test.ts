import { describe, expect, it } from "vitest";
import { exportPostmanCollection, importPostmanCollection } from "../src/importers/postman.js";
import { redactObject, collectSecretStrings } from "../src/secrets.js";

describe("secret redaction", () => {
  it("omits secret variable values from default export", () => {
    const src = {
      info: { name: "s", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
      variable: [{ key: "token", value: "super-secret-value", type: "secret" }],
      item: [{ name: "r", request: { method: "GET", url: "https://x.test" } }]
    };
    const preview = importPostmanCollection(src, "ws");
    const exported = exportPostmanCollection({
      collection: preview.collections[0]!,
      folders: preview.folders,
      requests: preview.requests,
      includeSecrets: false
    }) as { variable: Array<{ key: string; value: string }> };
    const token = exported.variable.find((v) => v.key === "token");
    expect(token?.value).toBe("");
  });

  it("redacts secret-looking keys from logs", () => {
    expect(JSON.stringify(redactObject({ authorization: "Bearer abc", ok: true }))).not.toContain("Bearer abc");
    expect(collectSecretStrings([{ key: "password", value: "p", secret: true }])).toEqual(["p"]);
  });
});
