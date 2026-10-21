import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(
  new URL("../scripts/set-release-version.mjs", import.meta.url),
);
test("release tags set every manifest and lockfile without changing dependency versions", () => {
  for (const [tag, version] of [
    ["v0.1", "0.1.0"],
    ["v1.2.3", "1.2.3"],
    ["v2.0.0-rc.1", "2.0.0-rc.1"],
  ]) {
    const root = mkdtempSync(join(tmpdir(), "release-test-"));
    try {
      mkdirSync(join(root, "src-tauri"));
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ version: "9.9.9" }),
      );
      writeFileSync(
        join(root, "package-lock.json"),
        JSON.stringify({
          version: "9.9.9",
          packages: {
            "": { version: "9.9.9" },
            dependency: { version: "3.2.1" },
          },
        }),
      );
      writeFileSync(
        join(root, "src-tauri/tauri.conf.json"),
        JSON.stringify({ version: "9.9.9" }),
      );
      writeFileSync(
        join(root, "src-tauri/Cargo.toml"),
        '[package]\nname = "lannihilator"\nversion = "9.9.9"\n',
      );
      writeFileSync(
        join(root, "src-tauri/Cargo.lock"),
        '[[package]]\r\nname = "other"\r\nversion = "3.2.1"\r\n\r\n[[package]]\r\nname = "lannihilator"\r\nversion = "9.9.9"\r\n',
      );
      const result = spawnSync(process.execPath, [script, tag], {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      for (const path of [
        "package.json",
        "package-lock.json",
        "src-tauri/tauri.conf.json",
      ]) {
        assert.equal(
          JSON.parse(readFileSync(join(root, path), "utf8")).version,
          version,
        );
      }
      const lock = JSON.parse(
        readFileSync(join(root, "package-lock.json"), "utf8"),
      );
      assert.equal(lock.packages[""].version, version);
      assert.equal(lock.packages.dependency.version, "3.2.1");
      for (const path of ["src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]) {
        assert.ok(
          readFileSync(join(root, path), "utf8").includes(
            `version = "${version}"`,
          ),
        );
      }
      assert.match(
        readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8"),
        /name = "other"\r\nversion = "3.2.1"/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("invalid or injectable release tags fail before accessing project files", () => {
  for (const tag of [
    "v0.01",
    "v1",
    "1.2.3",
    "v1.2.3-01",
    "v1.2.3;echo injected",
    "v1.2.3/evil",
  ]) {
    const result = spawnSync(process.execPath, [script, tag], {
      cwd: tmpdir(),
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Release tag must|leading zeroes/);
  }
});
