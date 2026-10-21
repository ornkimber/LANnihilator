import { stripTypeScriptTypes } from "node:module";
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

export const root = fileURLToPath(new URL("..", import.meta.url));
export async function build() {
  const destination = join(root, "dist");
  // Constant output directory, resolved against this script, never user input.
  await rm(destination, { recursive: true, force: true });
  await mkdir(join(destination, "src"), { recursive: true });
  await copyFile(join(root, "index.html"), join(destination, "index.html"));
  for (const name of await readdir(join(root, "src"))) {
    if (name.endsWith(".ts")) {
      const source = await readFile(join(root, "src", name), "utf8");
      await writeFile(
        join(destination, "src", name.replace(/\.ts$/, ".js")),
        stripTypeScriptTypes(source, {
          mode: "strip",
          sourceUrl: `src/${name}`,
        }),
      );
    } else if (name.endsWith(".css")) {
      await copyFile(join(root, "src", name), join(destination, "src", name));
    }
  }
  console.log("Built offline frontend → dist/");
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await build();
