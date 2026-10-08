#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  importPostmanCollection,
  importPostmanEnvironment,
  runCollection,
  toJsonReport,
  toJUnit,
  brand
} from "@postconet/core";

function arg(flag: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function has(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === "--help" || cmd === "help") {
    console.log(`${brand.productName} CLI
Usage:
  postconet run <collection.json> [--env file] [--reporters json,junit] [--out dir] [--bail]
Exit 1 if any assertion or request fails.`);
    return;
  }
  if (cmd !== "run") {
    console.error(`Unknown command ${cmd}`);
    process.exit(2);
  }
  const file = process.argv[3];
  if (!file) {
    console.error("Collection path required");
    process.exit(2);
  }
  const colJson = JSON.parse(await readFile(resolve(file), "utf8"));
  const preview = importPostmanCollection(colJson, "cli");
  let environment = preview.environments[0]?.values;
  const envPath = arg("--env");
  if (envPath) {
    const envJson = JSON.parse(await readFile(resolve(envPath), "utf8"));
    environment = importPostmanEnvironment(envJson, "cli").environments[0]?.values;
  }
  const result = await runCollection({
    collection: preview.collections[0]!,
    folders: preview.folders,
    requests: preview.requests,
    environment
  });
  const reporters = (arg("--reporters", "json") ?? "json").split(",");
  const outDir = arg("--out");
  const json = JSON.stringify(toJsonReport(result), null, 2);
  if (reporters.includes("json")) {
    if (outDir) {
      await mkdir(outDir, { recursive: true });
      await writeFile(resolve(outDir, "report.json"), json);
    } else console.log(json);
  }
  if (reporters.includes("junit") && outDir) {
    await mkdir(dirname(resolve(outDir, "junit.xml")), { recursive: true });
    await writeFile(resolve(outDir, "junit.xml"), toJUnit(result, brand.shortName));
  }
  if (result.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
void has;
