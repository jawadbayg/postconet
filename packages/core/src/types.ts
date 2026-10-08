export type Role = "owner" | "administrator" | "editor" | "viewer";

export type WorkspaceKind = "personal" | "private" | "shared";

export type EntityType =
  | "workspace"
  | "project"
  | "collection"
  | "folder"
  | "request"
  | "example"
  | "environment"
  | "globals"
  | "auth_profile"
  | "spec"
  | "mock"
  | "monitor"
  | "comment"
  | "invitation"
  | "organization";

export type ProtocolKind =
  | "http"
  | "graphql"
  | "grpc"
  | "websocket"
  | "socketio"
  | "sse"
  | "mqtt"
  | "soap"
  | "mcp";

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS"
  | "TRACE"
  | "CONNECT"
  | (string & {});

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
  type?: "text" | "secret" | "file";
  filePath?: string;
}

export interface Variable {
  id: string;
  key: string;
  value: string;
  initialValue?: string;
  sharedValue?: string;
  enabled: boolean;
  secret: boolean;
  description?: string;
}

export type AuthType =
  | "none"
  | "inherit"
  | "apikey"
  | "bearer"
  | "basic"
  | "digest"
  | "jwt"
  | "oauth1"
  | "oauth2"
  | "awsv4"
  | "hawk"
  | "ntlm"
  | "edgegrid"
  | "mtls";

export interface AuthConfig {
  type: AuthType;
  params: Record<string, string>;
  oauth2Token?: OAuth2Token;
}

export interface OAuth2Token {
  name: string;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  tokenType?: string;
  expiresAt?: string;
  shared: boolean;
}

export type BodyMode =
  | "none"
  | "raw"
  | "json"
  | "xml"
  | "html"
  | "javascript"
  | "text"
  | "urlencoded"
  | "formdata"
  | "file"
  | "graphql";

export interface RequestBody {
  mode: BodyMode;
  raw?: string;
  language?: "json" | "xml" | "html" | "javascript" | "text";
  urlencoded?: KeyValue[];
  formdata?: KeyValue[];
  filePath?: string;
  graphql?: { query: string; variables?: string; operationName?: string };
}

export interface ScriptBag {
  prerequest: string;
  test: string;
}

export interface RequestSettings {
  timeoutMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  encodeUrl: boolean;
  disableCookieJar: boolean;
  tlsVerify: boolean;
  http2: "auto" | "force" | "off";
  maxResponseBytes: number;
  proxy?: ProxySettings | null;
  clientCert?: CertSettings | null;
  caPath?: string | null;
}

export interface ProxySettings {
  protocol: "http" | "https";
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface CertSettings {
  certPath: string;
  keyPath: string;
  passphrase?: string;
}

export const defaultRequestSettings = (): RequestSettings => ({
  timeoutMs: 30_000,
  followRedirects: true,
  maxRedirects: 10,
  encodeUrl: true,
  disableCookieJar: false,
  tlsVerify: true,
  http2: "auto",
  maxResponseBytes: 25 * 1024 * 1024,
  proxy: null,
  clientCert: null,
  caPath: null
});

export interface HttpRequestDocument {
  protocol: "http" | "soap" | "graphql";
  method: HttpMethod;
  url: string;
  pathVariables: KeyValue[];
  query: KeyValue[];
  headers: KeyValue[];
  body: RequestBody;
  auth: AuthConfig;
  settings: RequestSettings;
  scripts: ScriptBag;
  description?: string;
}

export interface GraphQlRequestDocument extends Omit<HttpRequestDocument, "protocol"> {
  protocol: "graphql";
  subscriptionUrl?: string;
}

export interface WebSocketDocument {
  protocol: "websocket";
  url: string;
  protocols: string[];
  headers: KeyValue[];
  autoReconnect: boolean;
  auth: AuthConfig;
  scripts: ScriptBag;
}

export interface SocketIoDocument {
  protocol: "socketio";
  url: string;
  namespace: string;
  transports: Array<"websocket" | "polling">;
  auth: AuthConfig;
  extraHeaders: KeyValue[];
  scripts: ScriptBag;
}

export interface SseDocument {
  protocol: "sse";
  url: string;
  headers: KeyValue[];
  reconnection: boolean;
  auth: AuthConfig;
  scripts: ScriptBag;
}

export interface MqttDocument {
  protocol: "mqtt";
  url: string;
  clientId: string;
  username?: string;
  password?: string;
  keepalive: number;
  clean: boolean;
  qos: 0 | 1 | 2;
  tlsVerify: boolean;
  caPath?: string;
  certPath?: string;
  keyPath?: string;
  subscriptions: Array<{ topic: string; qos: 0 | 1 | 2 }>;
}

export interface GrpcDocument {
  protocol: "grpc";
  target: string;
  protoFiles: string[];
  includeDirs: string[];
  useReflection: boolean;
  service: string;
  method: string;
  metadata: KeyValue[];
  messageJson: string;
  tls: boolean;
  tlsVerify: boolean;
  deadlineMs: number;
  streaming: "unary" | "client" | "server" | "bidi";
}

export interface McpDocument {
  protocol: "mcp";
  transport: "stdio" | "sse" | "http";
  url?: string;
  command?: string;
  args?: string[];
  trusted: boolean;
  headers: KeyValue[];
}

export type RequestDocument =
  | HttpRequestDocument
  | GraphQlRequestDocument
  | WebSocketDocument
  | SocketIoDocument
  | SseDocument
  | MqttDocument
  | GrpcDocument
  | McpDocument;

export interface SavedRequest {
  id: string;
  workspaceId: string;
  collectionId: string;
  folderId: string | null;
  projectId: string | null;
  name: string;
  protocol: ProtocolKind;
  sortOrder: number;
  document: RequestDocument;
  examples: SavedExample[];
  favorite: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
  version: number;
  updatedAt: string;
  createdAt: string;
  unknown?: unknown;
}

export interface SavedExample {
  id: string;
  name: string;
  status: number;
  headers: KeyValue[];
  body: string;
  contentType?: string;
}

export interface Folder {
  id: string;
  workspaceId: string;
  collectionId: string;
  parentId: string | null;
  name: string;
  auth: AuthConfig;
  scripts: ScriptBag;
  sortOrder: number;
  archivedAt: string | null;
  deletedAt: string | null;
  version: number;
  updatedAt: string;
  createdAt: string;
}

export interface Collection {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  description?: string;
  auth: AuthConfig;
  variables: Variable[];
  scripts: ScriptBag;
  favorite: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
  version: number;
  updatedAt: string;
  createdAt: string;
  unknown?: unknown;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  sortOrder: number;
  archivedAt: string | null;
  deletedAt: string | null;
  version: number;
  updatedAt: string;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  organizationId: string | null;
  ownerUserId: string | null;
  description?: string;
  archivedAt: string | null;
  deletedAt: string | null;
  version: number;
  updatedAt: string;
  createdAt: string;
}

export interface Environment {
  id: string;
  workspaceId: string;
  name: string;
  values: Variable[];
  color?: string;
  archivedAt: string | null;
  deletedAt: string | null;
  version: number;
  updatedAt: string;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdBy: string;
  createdAt: string;
}

export interface Membership {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
}

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  acceptedAt: string | null;
}

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}

export interface SyncOp {
  id: string;
  idempotencyKey: string;
  entityType: EntityType;
  entityId: string;
  workspaceId: string | null;
  op: "upsert" | "delete";
  payload: unknown;
  version: number | null;
  baseVersion?: number | null;
  createdAt: string;
  attempts: number;
  lastError: string | null;
  status: "pending" | "sending" | "acked" | "rejected" | "conflict" | "failed";
}

export interface ChangeLogRow {
  seq: number;
  workspaceId: string;
  entityType: EntityType;
  entityId: string;
  op: "upsert" | "delete";
  version: number;
  payload: unknown;
  actorId: string;
  idempotencyKey: string;
  createdAt: string;
}

export type SyncState = "offline" | "syncing" | "synchronized" | "failed" | "conflicted";

export interface HeaderMap {
  [name: string]: string | string[];
}

export interface TimedPhase {
  name: string;
  milliseconds: number;
}

export interface HttpExchangeResult {
  ok: boolean;
  error?: string;
  status: number;
  statusText: string;
  httpVersion: string;
  headers: KeyValue[];
  cookies: KeyValue[];
  body: Buffer;
  bodyText: string;
  truncated: boolean;
  sizeBytes: number;
  elapsedMs: number;
  timeToFirstByteMs?: number;
  measuredTimings: TimedPhase[];
  url: string;
  redirected: boolean;
}

export interface ImportIssue {
  level: "error" | "warning" | "info";
  path: string;
  message: string;
  unsupported?: boolean;
}

export interface ImportPreview {
  format: string;
  title: string;
  collections: Collection[];
  requests: SavedRequest[];
  folders: Folder[];
  environments: Environment[];
  globals: Variable[];
  issues: ImportIssue[];
  missingFiles: string[];
  unknownPreserved: boolean;
}

export interface Permission {
  resource: string;
  action: "read" | "comment" | "edit" | "admin" | "owner";
}

export const ROLE_PERMISSIONS: Record<Role, Set<string>> = {
  viewer: new Set(["read"]),
  editor: new Set(["read", "comment", "edit"]),
  administrator: new Set(["read", "comment", "edit", "admin"]),
  owner: new Set(["read", "comment", "edit", "admin", "owner"])
};

export function can(role: Role, action: "read" | "comment" | "edit" | "admin" | "owner"): boolean {
  return ROLE_PERMISSIONS[role].has(action);
}

export function emptyAuth(type: AuthType = "inherit"): AuthConfig {
  return { type, params: {} };
}

export function emptyScripts(): ScriptBag {
  return { prerequest: "", test: "" };
}

export function emptyHttpDocument(): HttpRequestDocument {
  return {
    protocol: "http",
    method: "GET",
    url: "",
    pathVariables: [],
    query: [],
    headers: [],
    body: { mode: "none" },
    auth: emptyAuth("inherit"),
    settings: defaultRequestSettings(),
    scripts: emptyScripts()
  };
}
