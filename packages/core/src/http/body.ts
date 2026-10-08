import { readFile } from "node:fs/promises";
import type { RequestBody } from "../types.js";
import { activePairs } from "../kv.js";

export interface EncodedBody {
  buffer: Buffer | undefined;
  contentType?: string;
  multipart?: { boundary: string; chunks: Buffer };
}

export async function encodeBody(body: RequestBody, readFileImpl: (p: string) => Promise<Buffer> = (p) => readFile(p)): Promise<EncodedBody> {
  switch (body.mode) {
    case "none":
      return { buffer: undefined };
    case "json":
      return { buffer: Buffer.from(body.raw ?? "", "utf8"), contentType: "application/json" };
    case "xml":
    case "graphql": {
      if (body.mode === "graphql" && body.graphql) {
        const payload = {
          query: body.graphql.query,
          variables: body.graphql.variables ? JSON.parse(body.graphql.variables) : undefined,
          operationName: body.graphql.operationName
        };
        return { buffer: Buffer.from(JSON.stringify(payload), "utf8"), contentType: "application/json" };
      }
      return { buffer: Buffer.from(body.raw ?? "", "utf8"), contentType: "application/xml" };
    }
    case "html":
      return { buffer: Buffer.from(body.raw ?? "", "utf8"), contentType: "text/html" };
    case "javascript":
      return { buffer: Buffer.from(body.raw ?? "", "utf8"), contentType: "application/javascript" };
    case "text":
    case "raw":
      return { buffer: Buffer.from(body.raw ?? "", "utf8"), contentType: "text/plain" };
    case "urlencoded": {
      const params = new URLSearchParams();
      for (const { key, value } of activePairs(body.urlencoded ?? [])) params.append(key, value);
      return { buffer: Buffer.from(params.toString(), "utf8"), contentType: "application/x-www-form-urlencoded" };
    }
    case "formdata": {
      const boundary = `----PostConetForm${Date.now().toString(16)}`;
      const parts: Buffer[] = [];
      for (const field of body.formdata ?? []) {
        if (!field.enabled || !field.key) continue;
        if (field.type === "file" && field.filePath) {
          const file = await readFileImpl(field.filePath);
          const filename = field.filePath.split("/").pop() ?? "file";
          parts.push(
            Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="${field.key}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
            ),
            file,
            Buffer.from("\r\n")
          );
        } else {
          parts.push(
            Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="${field.key}"\r\n\r\n${field.value}\r\n`
            )
          );
        }
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      return { buffer: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
    }
    case "file": {
      if (!body.filePath) return { buffer: undefined };
      return { buffer: await readFileImpl(body.filePath), contentType: "application/octet-stream" };
    }
    default:
      return { buffer: undefined };
  }
}
