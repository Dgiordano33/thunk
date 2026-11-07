import { chmodSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// node-pty 1.1.0 ships its Unix spawn-helper without executable permissions.
if (process.platform !== "win32") {
  const root = path.dirname(fileURLToPath(import.meta.resolve("node-pty/package.json")));
  for (const relative of [`prebuilds/${process.platform}-${process.arch}/spawn-helper`, "build/Release/spawn-helper"]) {
    const helper = path.join(root, relative);
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
}
