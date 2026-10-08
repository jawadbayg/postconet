import { Agent, ProxyAgent, request, type Dispatcher } from "undici";
import { readFileSync } from "node:fs";
import type { AuthConfig, HttpExchangeResult, HttpRequestDocument, KeyValue, RequestSettings } from "../types.js";
import { activePairs, flattenHeaders, kv, toHeaderObject } from "../kv.js";
import { applyPathVariables, mergeQuery } from "./url.js";
import { encodeBody } from "./body.js";
import { applyAuth, applyDigestFromChallenge, inheritAuth } from "../auth/apply.js";
import { interpolate, type VariableScopes, type ResolveDiagnostics } from "../variables/resolve.js";
import { brand } from "../brand.js";

export interface ExecuteHttpInput {
  document: HttpRequestDocument;
  authChain: AuthConfig[];
  scopes: VariableScopes;
  cookies?: string;
  diagnostics?: ResolveDiagnostics;
  signal?: AbortSignal;
  readFile?: (path: string) => Promise<Buffer>;
}

function headerHas(headers: Record<string, string | string[]>, name: string): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase());
}

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase());
  if (!entry) return undefined;
  const value = entry[1];
  return Array.isArray(value) ? value.join(", ") : value;
}

function isHttp2Unavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /http2\.connect is not a function/i.test(message);
}

function dispatcherFor(settings: RequestSettings, allowH2: boolean): Dispatcher {
  const connect: Agent.Options["connect"] = {
    rejectUnauthorized: settings.tlsVerify
  };
  if (settings.caPath) {
    connect.ca = readFileSync(settings.caPath);
  }
  if (settings.clientCert?.certPath && settings.clientCert.keyPath) {
    connect.cert = readFileSync(settings.clientCert.certPath);
    connect.key = readFileSync(settings.clientCert.keyPath);
    if (settings.clientCert.passphrase) connect.passphrase = settings.clientCert.passphrase;
  }
  const agent = new Agent({
    connect,
    allowH2,
    headersTimeout: settings.timeoutMs,
    bodyTimeout: settings.timeoutMs
  });
  if (settings.proxy) {
    const auth =
      settings.proxy.username != null
        ? `${encodeURIComponent(settings.proxy.username)}:${encodeURIComponent(settings.proxy.password ?? "")}@`
        : "";
    const uri = `${settings.proxy.protocol}://${auth}${settings.proxy.host}:${settings.proxy.port}`;
    return new ProxyAgent({ uri, requestTls: connect });
  }
  return agent;
}

function toNodeHeaders(map: Record<string, string | string[]>): Record<string, string | string[]> {
  return map;
}

async function readLimited(stream: AsyncIterable<Buffer>, max: number): Promise<{ buffer: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (size + buf.length > max) {
      chunks.push(buf.subarray(0, Math.max(0, max - size)));
      truncated = true;
      break;
    }
    chunks.push(buf);
    size += buf.length;
  }
  return { buffer: Buffer.concat(chunks), truncated };
}

export async function executeHttp(input: ExecuteHttpInput): Promise<HttpExchangeResult> {
  const doc = input.document;
  const settings = doc.settings;
  const diagnostics = input.diagnostics ?? { missing: [], used: [] };
  const interpolateAll = (s: string) => interpolate(s, input.scopes, diagnostics);

  let url = interpolateAll(doc.url);
  url = applyPathVariables(
    url,
    doc.pathVariables.map((item) => ({ ...item, value: interpolateAll(item.value), key: interpolateAll(item.key) }))
  );
  const query = doc.query.map((item) => ({
    ...item,
    key: interpolateAll(item.key),
    value: interpolateAll(item.value)
  }));
  url = mergeQuery(url, query, settings.encodeUrl);

  const headersList = doc.headers.map((item) => ({
    ...item,
    key: interpolateAll(item.key),
    value: interpolateAll(item.value)
  }));

  const resolvedDoc = {
    ...doc,
    body: {
      ...doc.body,
      raw: doc.body.raw != null ? interpolateAll(doc.body.raw) : doc.body.raw,
      urlencoded: doc.body.urlencoded?.map((item) => ({ ...item, key: interpolateAll(item.key), value: interpolateAll(item.value) })),
      formdata: doc.body.formdata?.map((item) => ({ ...item, key: interpolateAll(item.key), value: interpolateAll(item.value) })),
      graphql: doc.body.graphql
        ? {
            query: interpolateAll(doc.body.graphql.query),
            variables: doc.body.graphql.variables ? interpolateAll(doc.body.graphql.variables) : undefined,
            operationName: doc.body.graphql.operationName
          }
        : undefined
    }
  };

  const encoded = await encodeBody(resolvedDoc.body, input.readFile);
  const auth = inheritAuth(input.authChain);
  const headerMap = toHeaderObject(headersList) as Record<string, string | string[]>;
  if (encoded.contentType && !headerHas(headerMap, "content-type")) {
    headerMap["Content-Type"] = encoded.contentType;
  }
  if (!headerHas(headerMap, "user-agent")) {
    headerMap["User-Agent"] = brand.defaultUserAgent;
  }
  if (input.cookies && !headerHas(headerMap, "cookie") && !settings.disableCookieJar) {
    headerMap.Cookie = input.cookies;
  }
  if (encoded.buffer && !headerHas(headerMap, "content-length") && !headerHas(headerMap, "transfer-encoding")) {
    headerMap["Content-Length"] = String(encoded.buffer.length);
  }

  const applied = await applyAuth({
    auth: {
      ...auth,
      params: Object.fromEntries(Object.entries(auth.params).map(([k, v]) => [k, interpolateAll(v)]))
    },
    method: doc.method,
    url,
    headers: Object.fromEntries(
      Object.entries(headerMap).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v])
    ),
    body: encoded.buffer ?? Buffer.alloc(0)
  });
  for (const h of applied.headers) headerMap[h.key] = h.value;
  if (applied.query.length) url = mergeQuery(url, applied.query, true);

  const executeOnce = async (allowH2: boolean): Promise<HttpExchangeResult> => {
    const dispatcher = dispatcherFor(settings, allowH2);
    const started = performance.now();
    let ttfb: number | undefined;

    const send = async (extra?: KeyValue[]) => {
      const headers = { ...headerMap };
      for (const h of extra ?? []) headers[h.key] = h.value;
      const res = await request(url, {
        method: doc.method,
        headers: toNodeHeaders(headers),
        body: encoded.buffer && !["GET", "HEAD"].includes(doc.method.toUpperCase()) ? encoded.buffer : undefined,
        dispatcher,
        signal: input.signal,
        maxRedirections: settings.followRedirects ? settings.maxRedirects : 0
      });
      ttfb = ttfb ?? performance.now() - started;
      return res;
    };

    try {
      let res = await send();
      if (res.statusCode === 401 && auth.type === "digest") {
        const www = getHeader(res.headers as Record<string, string | string[]>, "www-authenticate") ?? "";
        const digest = applyDigestFromChallenge(www, auth.params.username ?? "", auth.params.password ?? "", doc.method, url);
        if (digest) {
          await res.body.dump();
          res = await send([digest]);
        }
      }

      const { buffer, truncated } = await readLimited(res.body as AsyncIterable<Buffer>, settings.maxResponseBytes);
      const elapsed = performance.now() - started;
      const setCookie = res.headers["set-cookie"];
      const cookies: KeyValue[] = [];
      if (Array.isArray(setCookie)) setCookie.forEach((c) => cookies.push(kv("Set-Cookie", c)));
      else if (typeof setCookie === "string") cookies.push(kv("Set-Cookie", setCookie));

      const measured: HttpExchangeResult["measuredTimings"] = [{ name: "total", milliseconds: elapsed }];
      if (ttfb != null) measured.push({ name: "wait", milliseconds: ttfb });

      return {
        ok: res.statusCode >= 200 && res.statusCode < 400,
        status: res.statusCode,
        statusText: res.statusCode >= 200 && res.statusCode < 300 ? "OK" : String(res.statusCode),
        httpVersion: String((res as { httpVersion?: string }).httpVersion ?? (allowH2 ? "2.0" : "1.1")),
        headers: flattenHeaders(res.headers as Record<string, string | string[] | undefined>).filter(
          (h) => h.key.toLowerCase() !== "set-cookie"
        ),
        cookies,
        body: buffer,
        bodyText: buffer.toString("utf8"),
        truncated,
        sizeBytes: buffer.length,
        elapsedMs: elapsed,
        timeToFirstByteMs: ttfb,
        measuredTimings: measured,
        url,
        redirected: false
      };
    } catch (error) {
      const elapsed = performance.now() - started;
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        status: 0,
        statusText: "ERR",
        httpVersion: "",
        headers: [],
        cookies: [],
        body: Buffer.alloc(0),
        bodyText: "",
        truncated: false,
        sizeBytes: 0,
        elapsedMs: elapsed,
        measuredTimings: [{ name: "total", milliseconds: elapsed }],
        url,
        redirected: false
      };
    } finally {
      await dispatcher.close();
    }
  };

  const first = await executeOnce(settings.http2 !== "off");
  if (!first.ok && settings.http2 === "auto" && isHttp2Unavailable(first.error)) {
    return executeOnce(false);
  }
  return first;
}

export function prettyBody(text: string, contentType: string): string {
  if (contentType.includes("json") || looksLikeJson(text)) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

function looksLikeJson(text: string): boolean {
  const t = text.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

export function contentTypeOf(headers: KeyValue[]): string {
  return activePairs(headers).find((h) => h.key.toLowerCase() === "content-type")?.value ?? "";
}
