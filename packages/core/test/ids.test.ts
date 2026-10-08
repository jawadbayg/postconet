import { describe, expect, it } from "vitest";
import { createId } from "../src/ids.js";

describe("createId", () => {
  it("uses UUIDs for cloud-synced entities", () => {
    expect(createId("col")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(createId("req")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(createId("kv")).toMatch(/^kv_/);
  });
});
