import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { build, root } from "./build.mjs";

await build();
for (const directory of ["scripts", "dist/src"]) {
  for (const name of await readdir(join(root, directory))) {
    if (!/\.(mjs|js)$/.test(name)) continue;
    const result = spawnSync(
      process.execPath,
      ["--check", join(root, directory, name)],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  }
}
for (const file of [
  "package.json",
  "tsconfig.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/capabilities/main.json",
]) {
  JSON.parse(await readFile(join(root, file), "utf8"));
}
const configuration = JSON.parse(
  await readFile(join(root, "src-tauri/tauri.conf.json"), "utf8"),
);
assert.equal(configuration.app.windows[0].alwaysOnTop, true);
assert.equal(configuration.app.windows[0].decorations, false);
assert.equal(configuration.app.withGlobalTauri, true);
assert.equal(configuration.bundle.windows.webviewInstallMode.type, "skip");
console.log("JavaScript syntax and configuration checks passed.");
