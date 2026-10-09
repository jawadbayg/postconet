import { useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Plus } from "lucide-react";
import { CodeEditor } from "./CodeEditor";
import { languageForBodyMode, languageForText } from "../lib/editorLanguage";
import { invoke } from "../lib/ipc";
import { KeyValueEditor } from "./KeyValueEditor";
import { StreamPanel } from "./StreamPanel";
import { DispatchLoaderOverlay } from "./DispatchLoader";
import type { RequestRecord, Tab } from "../screens/Studio";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"];
const AUTH_TYPES = ["inherit", "none", "apikey", "bearer", "basic", "digest", "jwt", "oauth1", "oauth2", "awsv4", "hawk", "ntlm", "edgegrid"];

type Kv = { id: string; key: string; value: string; enabled: boolean };

export function RequestWorkbench(props: {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onPin: (id: string) => void;
  onChange: (req: RequestRecord) => void;
  onSave: () => void;
  remoteUpdated?: boolean;
  onReviewRemote?: () => void;
  workspaceId: string | null;
  environmentId: string | null;
  environments: Array<{ id: string; name: string }>;
  onEnvironment: (id: string | null) => void;
  authChain: Array<{ type: string; params: Record<string, string> }>;
  onAddRequest: () => void;
}) {
  const tab = props.tabs.find((t) => t.id === props.activeId);
  const [section, setSection] = useState<"params" | "auth" | "headers" | "body" | "scripts" | "settings">("params");
  const [respTab, setRespTab] = useState<"pretty" | "raw" | "preview" | "headers" | "cookies">("pretty");
  const [sending, setSending] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [response, setResponse] = useState<{
    status: number;
    statusText: string;
    elapsedMs: number;
    sizeBytes: number;
    truncated: boolean;
    bodyText: string;
    headers: Kv[];
    cookies: Kv[];
    error?: string;
    httpVersion: string;
    measuredTimings: Array<{ name: string; milliseconds: number }>;
  } | null>(null);

  const [findNonce, setFindNonce] = useState(0);
  const [copied, setCopied] = useState(false);
  const responsePaneRef = useRef<HTMLDivElement>(null);

  const pretty = useMemo(() => {
    if (!response?.bodyText) return "";
    try {
      return JSON.stringify(JSON.parse(response.bodyText), null, 2);
    } catch {
      return response.bodyText;
    }
  }, [response]);

  const responseLanguage = useMemo(() => {
    const contentType = response?.headers.find((h) => h.key.toLowerCase() === "content-type")?.value ?? "";
    return languageForText(pretty || response?.bodyText || "", contentType);
  }, [pretty, response]);

  const responseText = respTab === "raw" ? (response?.bodyText ?? "") : pretty;

  useEffect(() => {
    function openFind() {
      if (!response) return;
      setFindNonce((n) => n + 1);
    }
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "f" || e.shiftKey || e.altKey) return;
      if (!response) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT") && !responsePaneRef.current?.contains(el)) return;
      e.preventDefault();
      e.stopPropagation();
      openFind();
    }
    window.addEventListener("keydown", onKey, true);
    const offMenu = window.postconet?.on("menu", (action) => {
      if (action === "find") openFind();
    });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      offMenu?.();
    };
  }, [response]);

  async function copyResponse() {
    const text = responseText;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  const tabBar = (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--panel)] px-1">
      {props.tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => props.onSelect(t.id)}
          className={`group flex items-center gap-2 border-r border-[var(--border)] px-3 py-2 text-xs ${t.id === props.activeId ? "bg-[var(--canvas)]" : ""}`}
        >
          {t.pinned ? "• " : ""}
          {t.dirty ? "● " : ""}
          {t.request.name}
          <span className="hidden text-[var(--muted)] group-hover:inline" onClick={(e) => (e.stopPropagation(), props.onClose(t.id))}>
            ×
          </span>
        </button>
      ))}
      <button
        type="button"
        title="New request in this folder"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--canvas)] hover:text-[var(--fg)]"
        onClick={props.onAddRequest}
      >
        <Plus size={14} />
      </button>
    </div>
  );

  if (!tab) {
    return (
      <div className="flex h-full flex-col bg-[var(--canvas)]">
        {tabBar}
        <div className="flex min-h-[320px] flex-1 items-center justify-center text-sm text-[#667085]">
          Open or create a request from the sidebar.
        </div>
      </div>
    );
  }

  const current = tab;
  const protocol = current.request.protocol;
  const streaming = protocol === "websocket" || protocol === "sse" || protocol === "mqtt" || protocol === "socketio";
  const doc = current.request.document as {
    method: string;
    url: string;
    query: Kv[];
    pathVariables: Kv[];
    headers: Kv[];
    body: { mode: string; raw?: string; language?: string; urlencoded?: Kv[]; formdata?: Kv[] };
    auth: { type: string; params: Record<string, string> };
    scripts: { prerequest: string; test: string };
    settings: { timeoutMs: number; followRedirects: boolean; tlsVerify: boolean; maxResponseBytes: number };
  };

  function patchDoc(patch: Partial<typeof doc>) {
    props.onChange({ ...current.request, document: { ...doc, ...patch } });
  }

  async function send() {
    if (!props.workspaceId) return;
    const id = crypto.randomUUID();
    setExecutionId(id);
    setSending(true);
    setResponse(null);
    try {
      const res = await invoke<{
        status: number;
        statusText: string;
        elapsedMs: number;
        sizeBytes: number;
        truncated: boolean;
        bodyText: string;
        bodyBase64: string;
        headers: Kv[];
        cookies: Kv[];
        error?: string;
        httpVersion: string;
        measuredTimings: Array<{ name: string; milliseconds: number }>;
      }>("request.send", {
        executionId: id,
        workspaceId: props.workspaceId,
        requestId: current.request.id,
        document: doc,
        authChain: props.authChain,
        environmentId: props.environmentId
      });
      const bodyText = res.bodyText || (res.bodyBase64 ? atob(res.bodyBase64) : "");
      setResponse({ ...res, bodyText });
    } catch (e) {
      setResponse({
        status: 0,
        statusText: "ERR",
        elapsedMs: 0,
        sizeBytes: 0,
        truncated: false,
        bodyText: "",
        headers: [],
        cookies: [],
        error: e instanceof Error ? e.message : String(e),
        httpVersion: "",
        measuredTimings: []
      });
    } finally {
      setSending(false);
      setExecutionId(null);
    }
  }

  return (
    <div className="flex h-full flex-col bg-[var(--canvas)]">
      {tabBar}
      {props.remoteUpdated && tab && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-100">
          <span>Someone updated this API while you were editing. Your draft is still here.</span>
          <button type="button" className="rounded-md border border-amber-700/40 px-2 py-1" onClick={props.onReviewRemote}>
            Review versions
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-3 py-2">
        <select
          className="rounded-md border border-[var(--border)] bg-[var(--canvas)] px-2 py-1 text-xs"
          value={protocol}
          onChange={(e) => props.onChange({ ...tab.request, protocol: e.target.value })}
        >
          {["http", "graphql", "soap", "websocket", "sse", "mqtt", "socketio", "grpc", "mcp"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        {!streaming && (
        <select className="rounded-md border border-[var(--border)] bg-[var(--canvas)] px-2 py-1 font-mono text-xs" value={doc.method} onChange={(e) => patchDoc({ method: e.target.value })}>
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        )}
        <input
          className="flex-1 rounded-md border border-[var(--border)] bg-[var(--canvas)] px-3 py-1.5 font-mono text-sm"
          value={doc.url}
          placeholder="https://api.example.com/{{path}}"
          onChange={(e) => patchDoc({ url: e.target.value })}
        />
        {!streaming && (
        <button className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50" onClick={() => void send()} disabled={sending}>
          Send
        </button>
        )}
        {sending && executionId && (
          <button className="text-xs text-red-600" onClick={() => invoke("request.cancel", { executionId })}>
            Cancel
          </button>
        )}
        <button className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs" onClick={props.onSave}>
          Save
        </button>
        <select className="rounded-md border border-[var(--border)] bg-[var(--canvas)] px-2 py-1 text-xs" value={props.environmentId ?? ""} onChange={(e) => props.onEnvironment(e.target.value || null)}>
          <option value="">No environment</option>
          {props.environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
            </option>
          ))}
        </select>
      </div>
      {protocol === "mcp" && (
        <div className="p-4 text-sm">
          <p className="mb-2 text-[var(--muted)]">Remote MCP uses Streamable HTTP/SSE. Local stdio requires an explicit trust confirmation and never runs during import.</p>
          <button className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-white" onClick={() => void invoke("mcp.http", { url: doc.url })}>
            Initialize remote MCP
          </button>
        </div>
      )}
      {protocol === "grpc" && (
        <div className="p-4 text-sm text-[var(--muted)]">
          gRPC unary and streaming run in the main process via <code>@grpc/grpc-js</code>. Load .proto files with File → Import. Reflection is supported when the server exposes it.
        </div>
      )}
      {streaming ? (
        <StreamPanel requestId={tab.request.id} protocol={protocol as "websocket" | "sse" | "mqtt" | "socketio"} url={doc.url} />
      ) : protocol === "mcp" || protocol === "grpc" ? null : (
      <div className="relative min-h-0 flex-1">
      {sending && <DispatchLoaderOverlay size={140} />}
      <PanelGroup direction="vertical" className="h-full min-h-0">
        <Panel defaultSize={52} minSize={25}>
          <div className="flex h-full flex-col">
            <div className="flex gap-1 border-b border-[var(--border)] px-2 text-xs">
              {(["params", "auth", "headers", "body", "scripts", "settings"] as const).map((s) => (
                <button key={s} className={`px-3 py-2 capitalize ${section === s ? "border-b-2 border-[var(--accent)]" : "text-[var(--muted)]"}`} onClick={() => setSection(s)}>
                  {s}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {section === "params" && (
                <div className="h-full overflow-auto">
                  <div className="px-3 py-2 text-[10px] uppercase text-[var(--muted)]">Query</div>
                  <KeyValueEditor items={doc.query ?? []} onChange={(query) => patchDoc({ query })} />
                  <div className="px-3 py-2 text-[10px] uppercase text-[var(--muted)]">Path</div>
                  <KeyValueEditor items={doc.pathVariables ?? []} onChange={(pathVariables) => patchDoc({ pathVariables })} />
                </div>
              )}
              {section === "headers" && (
                <div className="h-full overflow-auto">
                  <KeyValueEditor items={doc.headers ?? []} onChange={(headers) => patchDoc({ headers })} />
                </div>
              )}
              {section === "auth" && (
                <div className="h-full space-y-3 overflow-auto p-3 text-xs">
                  <label className="block">
                    Type
                    <select className="ml-2 rounded border border-[var(--border)] bg-[var(--canvas)] px-2 py-1" value={doc.auth.type} onChange={(e) => patchDoc({ auth: { ...doc.auth, type: e.target.value } })}>
                      {AUTH_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  {doc.auth.type === "bearer" && (
                    <input className="w-full rounded border border-[var(--border)] bg-[var(--canvas)] px-2 py-1" placeholder="Token" value={doc.auth.params.token ?? ""} onChange={(e) => patchDoc({ auth: { ...doc.auth, params: { ...doc.auth.params, token: e.target.value } } })} />
                  )}
                  {doc.auth.type === "basic" && (
                    <div className="flex gap-2">
                      <input className="flex-1 rounded border border-[var(--border)] bg-[var(--canvas)] px-2 py-1" placeholder="Username" value={doc.auth.params.username ?? ""} onChange={(e) => patchDoc({ auth: { ...doc.auth, params: { ...doc.auth.params, username: e.target.value } } })} />
                      <input className="flex-1 rounded border border-[var(--border)] bg-[var(--canvas)] px-2 py-1" placeholder="Password" type="password" value={doc.auth.params.password ?? ""} onChange={(e) => patchDoc({ auth: { ...doc.auth, params: { ...doc.auth.params, password: e.target.value } } })} />
                    </div>
                  )}
                  {doc.auth.type === "apikey" && (
                    <div className="flex gap-2">
                      <input className="flex-1 rounded border border-[var(--border)] bg-[var(--canvas)] px-2 py-1" placeholder="Key" value={doc.auth.params.key ?? ""} onChange={(e) => patchDoc({ auth: { ...doc.auth, params: { ...doc.auth.params, key: e.target.value } } })} />
                      <input className="flex-1 rounded border border-[var(--border)] bg-[var(--canvas)] px-2 py-1" placeholder="Value" value={doc.auth.params.value ?? ""} onChange={(e) => patchDoc({ auth: { ...doc.auth, params: { ...doc.auth.params, value: e.target.value } } })} />
                      <select className="rounded border border-[var(--border)] bg-[var(--canvas)] px-2" value={doc.auth.params.in ?? "header"} onChange={(e) => patchDoc({ auth: { ...doc.auth, params: { ...doc.auth.params, in: e.target.value } } })}>
                        <option value="header">Header</option>
                        <option value="query">Query</option>
                      </select>
                    </div>
                  )}
                  {doc.auth.type === "oauth2" && (
                    <div className="space-y-2">
                      {["authUrl", "accessTokenUrl", "clientId", "clientSecret", "scope"].map((key) => (
                        <input key={key} className="w-full rounded border border-[var(--border)] bg-[var(--canvas)] px-2 py-1" placeholder={key} value={doc.auth.params[key] ?? ""} onChange={(e) => patchDoc({ auth: { ...doc.auth, params: { ...doc.auth.params, [key]: e.target.value } } })} />
                      ))}
                      <button
                        className="rounded bg-[var(--accent)] px-2 py-1 text-white"
                        onClick={async () => {
                          const token = await invoke<Record<string, string>>("oauth.authorize", {
                            grantType: "authorization_code_pkce",
                            authUrl: doc.auth.params.authUrl,
                            accessTokenUrl: doc.auth.params.accessTokenUrl,
                            clientId: doc.auth.params.clientId,
                            clientSecret: doc.auth.params.clientSecret,
                            callbackUrl: "http://127.0.0.1/oauth/callback",
                            scope: doc.auth.params.scope,
                            clientAuth: "body"
                          });
                          patchDoc({ auth: { ...doc.auth, params: { ...doc.auth.params, accessToken: String(token.access_token ?? "") } } });
                        }}
                      >
                        Get token in system browser (PKCE)
                      </button>
                    </div>
                  )}
                  {["oauth1", "awsv4", "jwt", "hawk", "ntlm", "edgegrid", "digest"].includes(doc.auth.type) && (
                    <p className="text-[var(--muted)]">Helper parameters are applied in the main process when you send. JWT/AWS/Hawk/OAuth1/EdgeGrid/Digest have dedicated engines.</p>
                  )}
                </div>
              )}
              {section === "body" && (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-1 text-xs">
                    {["none", "json", "text", "xml", "html", "javascript", "urlencoded", "formdata"].map((mode) => (
                      <button
                        key={mode}
                        className={doc.body.mode === mode ? "text-[var(--accent)]" : "text-[var(--muted)]"}
                        onClick={() =>
                          patchDoc({
                            body: {
                              ...doc.body,
                              mode,
                              language: mode === "json" ? "json" : doc.body.language
                            }
                          })
                        }
                      >
                        {mode}
                      </button>
                    ))}
                    {doc.body.mode === "json" && (
                      <button
                        className="ml-auto text-[var(--accent)]"
                        onClick={() => {
                          try {
                            patchDoc({ body: { ...doc.body, raw: JSON.stringify(JSON.parse(doc.body.raw || "null"), null, 2) } });
                          } catch {
                            /* Monaco shows the syntax error in the gutter */
                          }
                        }}
                      >
                        Pretty
                      </button>
                    )}
                  </div>
                  {["json", "text", "xml", "html", "javascript", "raw"].includes(doc.body.mode) && (
                    <div className="min-h-0 flex-1">
                      <CodeEditor
                        height="100%"
                        language={languageForBodyMode(doc.body.mode)}
                        value={doc.body.raw ?? ""}
                        onChange={(v) => patchDoc({ body: { ...doc.body, raw: v } })}
                      />
                    </div>
                  )}
                  {doc.body.mode === "urlencoded" && <KeyValueEditor items={doc.body.urlencoded ?? []} onChange={(urlencoded) => patchDoc({ body: { ...doc.body, urlencoded } })} />}
                  {doc.body.mode === "formdata" && <KeyValueEditor items={doc.body.formdata ?? []} onChange={(formdata) => patchDoc({ body: { ...doc.body, formdata } })} />}
                </div>
              )}
              {section === "scripts" && (
                <div className="grid h-full grid-cols-2">
                  <div className="min-h-0">
                    <div className="px-2 py-1 text-[10px] uppercase text-[var(--muted)]">Pre-request</div>
                    <CodeEditor height="240px" language="javascript" value={doc.scripts.prerequest} onChange={(v) => patchDoc({ scripts: { ...doc.scripts, prerequest: v } })} />
                  </div>
                  <div className="min-h-0">
                    <div className="px-2 py-1 text-[10px] uppercase text-[var(--muted)]">Post-response</div>
                    <CodeEditor height="240px" language="javascript" value={doc.scripts.test} onChange={(v) => patchDoc({ scripts: { ...doc.scripts, test: v } })} />
                  </div>
                </div>
              )}
              {section === "settings" && (
                <div className="h-full space-y-2 overflow-auto p-3 text-xs">
                  <label className="flex items-center gap-2">
                    Timeout (ms)
                    <input type="number" className="rounded border border-[var(--border)] bg-[var(--canvas)] px-2 py-1" value={doc.settings.timeoutMs} onChange={(e) => patchDoc({ settings: { ...doc.settings, timeoutMs: Number(e.target.value) } })} />
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={doc.settings.followRedirects} onChange={(e) => patchDoc({ settings: { ...doc.settings, followRedirects: e.target.checked } })} />
                    Follow redirects
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={doc.settings.tlsVerify} onChange={(e) => patchDoc({ settings: { ...doc.settings, tlsVerify: e.target.checked } })} />
                    Verify TLS (secure default)
                  </label>
                </div>
              )}
            </div>
          </div>
        </Panel>
        <PanelResizeHandle className="h-px bg-[var(--border)]" />
        <Panel minSize={20}>
          <div ref={responsePaneRef} className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1 text-xs">
              <div className="flex gap-3">
                {response ? (
                  <>
                    <span className={response.status >= 200 && response.status < 300 ? "text-emerald-600" : "text-red-600"}>
                      {response.error ? response.error : `${response.status} ${response.statusText}`}
                    </span>
                    <span className="text-[var(--muted)]">{Math.round(response.elapsedMs)} ms</span>
                    <span className="text-[var(--muted)]">{response.sizeBytes} B</span>
                    {response.httpVersion && <span className="text-[var(--muted)]">HTTP {response.httpVersion}</span>}
                    {response.truncated && <span className="text-amber-600">truncated</span>}
                    {response.measuredTimings.map((t) => (
                      <span key={t.name} className="text-[var(--muted)]">
                        {t.name} {Math.round(t.milliseconds)}ms
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="text-[var(--muted)]">Response</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {(["pretty", "raw", "preview", "headers", "cookies"] as const).map((t) => (
                  <button key={t} className={respTab === t ? "text-[var(--accent)]" : "text-[var(--muted)]"} onClick={() => setRespTab(t)}>
                    {t}
                  </button>
                ))}
                {response && (respTab === "pretty" || respTab === "raw") && (
                  <>
                    <button className="rounded border border-[var(--border)] px-2 py-0.5" onClick={() => setFindNonce((n) => n + 1)}>
                      Find
                    </button>
                    <button className="rounded border border-[var(--border)] px-2 py-0.5" onClick={() => void copyResponse()}>
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {respTab === "pretty" && response && (
                <CodeEditor height="100%" language={responseLanguage} value={pretty} readOnly findRequest={findNonce} />
              )}
              {respTab === "raw" && response && (
                <CodeEditor height="100%" language={responseLanguage} value={response.bodyText} readOnly findRequest={findNonce} />
              )}
              {respTab === "preview" && response && (
                <iframe
                  title="HTML preview"
                  sandbox="allow-scripts"
                  className="h-full w-full bg-white"
                  srcDoc={response.bodyText}
                  referrerPolicy="no-referrer"
                />
              )}
              {respTab === "headers" && response && (
                <table className="w-full text-xs">
                  <tbody>
                    {response.headers.map((h) => (
                      <tr key={h.id} className="border-b border-[var(--border)]">
                        <td className="px-3 py-1 font-medium">{h.key}</td>
                        <td className="px-3 py-1 font-mono">{h.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {respTab === "cookies" && response && (
                <pre className="p-3 font-mono text-xs">{JSON.stringify(response.cookies, null, 2)}</pre>
              )}
            </div>
          </div>
        </Panel>
      </PanelGroup>
      </div>
      )}
    </div>
  );
}
