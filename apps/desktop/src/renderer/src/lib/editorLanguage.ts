export function languageForBodyMode(mode: string): string {
  if (mode === "json") return "json";
  if (mode === "javascript") return "javascript";
  if (mode === "xml") return "xml";
  if (mode === "html") return "html";
  return "plaintext";
}

export function languageForText(text: string, contentType = ""): string {
  const type = contentType.toLowerCase();
  const trimmed = text.trim();
  if (type.includes("json") || (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return "json";
  }
  if (type.includes("xml") || trimmed.startsWith("<?xml")) return "xml";
  if (type.includes("html") || trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) return "html";
  if (type.includes("javascript") || type.includes("ecmascript")) return "javascript";
  return "plaintext";
}
