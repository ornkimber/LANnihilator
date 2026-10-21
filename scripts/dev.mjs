import { createServer } from "node:http";
import { readFile, watch } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { build, root } from "./build.mjs";

await build();
const dist = join(root, "dist");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(
      url.pathname === "/" ? "/index.html" : url.pathname,
    );
    const file = resolve(dist, "." + pathname);
    if (!file.startsWith(dist + sep)) {
      response.writeHead(403).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(await readFile(file));
  } catch {
    if (!response.headersSent) response.writeHead(404);
    response.end();
  }
});
server.listen(1420, "127.0.0.1", () =>
  console.log("Local DEMO: http://127.0.0.1:1420 (no real adapter control)"),
);
server.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
if (!process.argv.includes("--production")) {
  let pending;
  for (const directory of [join(root, "src"), root]) {
    void (async () => {
      for await (const event of watch(directory)) {
        if (!event.filename?.match(/\.(ts|css|html)$/)) continue;
        clearTimeout(pending);
        pending = setTimeout(() => {
          void build().catch(console.error);
        }, 100);
      }
    })().catch(console.error);
  }
}
