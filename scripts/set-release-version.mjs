import { readFile, writeFile } from "node:fs/promises";

const tag = process.argv[2];
const match =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
    tag ?? "",
  );
if (!match)
  throw new Error(
    "Release tag must be v<major>.<minor>[.<patch>][-prerelease].",
  );
const prerelease = match[4] ?? "";
if (
  prerelease
    .slice(1)
    .split(".")
    .some((part) => /^0\d+$/.test(part))
) {
  throw new Error("Numeric prerelease identifiers cannot have leading zeroes.");
}
const version = `${match[1]}.${match[2]}.${match[3] ?? "0"}${prerelease}`;
const changes = [];
for (const path of [
  "package.json",
  "package-lock.json",
  "src-tauri/tauri.conf.json",
]) {
  const json = JSON.parse(await readFile(path, "utf8"));
  json.version = version;
  if (path === "package-lock.json") json.packages[""].version = version;
  changes.push([path, `${JSON.stringify(json, null, 2)}\n`]);
}
for (const path of ["src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]) {
  const source = await readFile(path, "utf8");
  const expression = path.endsWith("Cargo.lock")
    ? /(\[\[package\]\]\r?\nname = "lannihilator"\r?\nversion = ")[^"]+(")/
    : /(\[package\][\s\S]*?\r?\nversion = ")[^"]+(")/;
  if (!expression.test(source))
    throw new Error(`Cannot locate app version in ${path}`);
  changes.push([
    path,
    source.replace(
      expression,
      (_, before, after) => `${before}${version}${after}`,
    ),
  ]);
}
for (const [path, contents] of changes) await writeFile(path, contents);
console.log(`Release ${tag}: packaging app version ${version}`);
