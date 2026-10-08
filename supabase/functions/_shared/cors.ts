export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "content-type": "application/json" }
  });
}

export function text(body: string, status = 200, extra: Record<string, string> = {}) {
  return new Response(body, { status, headers: { ...cors, ...extra } });
}
