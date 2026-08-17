import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = path.join(
  root,
  "node_modules",
  "@deepseek-ai",
  "dsh-host-directory-picker-native",
  "lib",
  "index.js",
);
const marker = "function resolveDialogWorkerPath() {";

let source;
try {
  source = await fs.readFile(target, "utf8");
} catch (error) {
  if (error.code === "ENOENT") process.exit(0);
  throw error;
}
if (source.includes(marker)) process.exit(0);

const oldCode = 'if (!import.meta.url.endsWith(".ts")) return spawn(process.execPath, [fileURLToPath(new URL("./worker.cjs", import.meta.url))], {';
const newCode = `${marker}
\tconst modulePath = fileURLToPath(new URL("./worker.cjs", import.meta.url));
\treturn modulePath.includes(".asar\\\\") ? modulePath.replace(".asar\\\\", ".asar.unpacked\\\\") : modulePath;
}
if (!import.meta.url.endsWith(".ts")) return spawn(process.execPath, [resolveDialogWorkerPath()], {`;
if (!source.includes(oldCode)) throw new Error("Unsupported dsh directory-picker-native version");
await fs.writeFile(target, source.replace(oldCode, newCode), "utf8");
