export async function invokeGrpcUnary(opts: {
  target: string;
  protoPath: string;
  includeDirs?: string[];
  service: string;
  method: string;
  message: object;
  metadata?: Record<string, string>;
  tls?: boolean;
  deadlineMs?: number;
}): Promise<{ ok: boolean; payload?: unknown; error?: string }> {
  const grpc = await import("@grpc/grpc-js");
  const protoLoader = await import("@grpc/proto-loader");
  const def = await protoLoader.load(opts.protoPath, {
    includeDirs: opts.includeDirs,
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true
  });
  const pkg = grpc.loadPackageDefinition(def) as Record<string, unknown>;
  const Service = lookup(pkg, opts.service) as new (target: string, creds: unknown) => {
    [k: string]: unknown;
  };
  const creds = opts.tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
  const client = new Service(opts.target, creds);
  const fn = client[opts.method] as ((req: unknown, meta: unknown, opts: unknown, cb: (err: Error | null, res: unknown) => void) => void) | undefined;
  if (typeof fn !== "function") return { ok: false, error: `Unknown method ${opts.method}` };
  const meta = new grpc.Metadata();
  for (const [k, v] of Object.entries(opts.metadata ?? {})) meta.set(k, v);
  return await new Promise((resolve) => {
    fn.call(
      client,
      opts.message,
      meta,
      { deadline: Date.now() + (opts.deadlineMs ?? 10_000) },
      (err, res) => {
        if (err) resolve({ ok: false, error: err.message });
        else resolve({ ok: true, payload: res });
      }
    );
  });
}

function lookup(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], obj);
}
