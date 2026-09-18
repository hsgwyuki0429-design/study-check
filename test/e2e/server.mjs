// E2E の下ごしらえ。静的ファイルを配るだけのサーバーを1つ立てる。
//
// このアプリにはサーバーが要らない。学習データはすべて端末の中にある。
// ここで立てるのは、ブラウザに index.html と src/*.js を読ませるためだけのもので、
// 「オフラインにする」＝配るのをやめる、という意味になる。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    return null;
  }
}

export async function startTestServer() {
  let offline = false;

  const server = createServer(async (request, response) => {
    if (offline) {
      request.socket.destroy();
      return;
    }
    const url = new URL(request.url, "http://localhost");
    const relative = url.pathname === "/" ? "/index.html" : url.pathname;
    // ルートの外へは出さない。
    const file = path.join(root, path.normalize(relative).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    origin: `http://127.0.0.1:${port}`,
    goOffline() { offline = true; },
    goOnline() { offline = false; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
