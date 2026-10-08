import { copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const icon = join(here, "../resources/icon.icns");
if (!existsSync(icon)) {
  console.warn("PostConet icon missing:", icon);
  process.exit(0);
}

const electronBin = createRequire(import.meta.url)("electron");
const dest = join(dirname(electronBin), "../Resources/electron.icns");
if (!existsSync(dest)) {
  console.warn("Electron bundle icon not found:", dest);
  process.exit(0);
}

copyFileSync(icon, dest);
console.log("Applied PostConet icon to Electron.app for development.");
