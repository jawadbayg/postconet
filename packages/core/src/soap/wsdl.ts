import { XMLParser } from "fast-xml-parser";

export interface WsdlOperation {
  name: string;
  soapAction?: string;
  input?: string;
}

export function operationsFromWsdl(xml: string): WsdlOperation[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const ops: WsdlOperation[] = [];
  walk(doc, (node) => {
    if (node && typeof node === "object" && "name" in node && ("soapAction" in node || "soap:operation" in node || Object.keys(node).some((k) => k.includes("operation")))) {
      const name = String((node as { name?: string }).name ?? "");
      if (name && !ops.some((o) => o.name === name) && !(node as { targetNamespace?: string }).targetNamespace) {
        /* collected below */
      }
    }
  });
  const raw = xml.matchAll(/<operation[^>]*name="([^"]+)"[^>]*>/g);
  for (const m of raw) ops.push({ name: m[1]!, soapAction: undefined });
  const actions = [...xml.matchAll(/soapAction="([^"]*)"/g)].map((m) => m[1]!);
  ops.forEach((op, i) => {
    if (actions[i]) op.soapAction = actions[i];
  });
  return unique(ops);
}

export function soapEnvelope(bodyXml: string, soapAction?: string): { xml: string; headers: Record<string, string> } {
  const xml = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${bodyXml}</soap:Body></soap:Envelope>`;
  const headers: Record<string, string> = { "Content-Type": "text/xml; charset=utf-8" };
  if (soapAction) headers.SOAPAction = soapAction;
  return { xml, headers };
}

function walk(node: unknown, visit: (n: Record<string, unknown>) => void) {
  if (!node || typeof node !== "object") return;
  visit(node as Record<string, unknown>);
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach((i) => walk(i, visit));
    else walk(v, visit);
  }
}

function unique(ops: WsdlOperation[]): WsdlOperation[] {
  const seen = new Set<string>();
  return ops.filter((o) => (seen.has(o.name) ? false : (seen.add(o.name), true)));
}
