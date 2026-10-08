import type { HttpRequestDocument } from "../types.js";

export interface Snippet {
  id: string;
  language: string;
  label: string;
  code: string;
}

function headerLines(doc: HttpRequestDocument, indent: string, style: "js" | "php" | "py" | "curl"): string {
  return doc.headers
    .filter((h) => h.enabled && h.key)
    .map((h) => {
      if (style === "js") return `${indent}'${h.key}': '${escape(h.value)}',`;
      if (style === "php") return `${indent}'${h.key}' => '${escape(h.value)}',`;
      if (style === "py") return `${indent}'${h.key}': '${escape(h.value)}',`;
      return `-H '${h.key}: ${escape(h.value)}'`;
    })
    .join("\n");
}

function escape(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function urlOf(doc: HttpRequestDocument) {
  const q = doc.query
    .filter((x) => x.enabled && x.key)
    .map((x) => `${encodeURIComponent(x.key)}=${encodeURIComponent(x.value)}`)
    .join("&");
  return q ? `${doc.url}${doc.url.includes("?") ? "&" : "?"}${q}` : doc.url;
}

export function generateSnippets(doc: HttpRequestDocument): Snippet[] {
  const url = urlOf(doc);
  const body = doc.body.raw ?? "";
  return [
    {
      id: "curl",
      language: "bash",
      label: "cURL",
      code: [`curl -X ${doc.method} '${url}'`, headerLines(doc, "  ", "curl"), body ? `--data-raw '${escape(body)}'` : ""].filter(Boolean).join(" \\\n  ")
    },
    {
      id: "fetch",
      language: "javascript",
      label: "JavaScript (fetch)",
      code: `const res = await fetch('${url}', {\n  method: '${doc.method}',\n  headers: {\n${headerLines(doc, "    ", "js")}\n  }${body ? `,\n  body: '${escape(body)}'` : ""}\n});\nconst data = await res.json();`
    },
    {
      id: "php-curl",
      language: "php",
      label: "PHP (cURL)",
      code: `<?php\n$ch = curl_init('${url}');\ncurl_setopt($ch, CURLOPT_CUSTOMREQUEST, '${doc.method}');\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\ncurl_setopt($ch, CURLOPT_HTTPHEADER, [\n${doc.headers.filter((h) => h.enabled).map((h) => `    '${escape(h.key)}: ${escape(h.value)}',`).join("\n")}\n]);${body ? `\ncurl_setopt($ch, CURLOPT_POSTFIELDS, '${escape(body)}');` : ""}\n$response = curl_exec($ch);\ncurl_close($ch);`
    },
    {
      id: "laravel-http",
      language: "php",
      label: "PHP (Laravel HTTP)",
      code: `use Illuminate\\Support\\Facades\\Http;\n\n$response = Http::withHeaders([\n${headerLines(doc, "    ", "php")}\n])${body ? `->withBody('${escape(body)}', 'application/json')` : ""}->send('${doc.method}', '${url}');\n\n$data = $response->json();`
    },
    {
      id: "python-requests",
      language: "python",
      label: "Python (requests)",
      code: `import requests\n\nres = requests.request(\n    '${doc.method}',\n    '${url}',\n    headers={\n${headerLines(doc, "        ", "py")}\n    },${body ? `\n    data='${escape(body)}',` : ""}\n)\nprint(res.status_code, res.text)`
    }
  ];
}
