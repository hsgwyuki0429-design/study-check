// E2E の下ごしらえ。静的ファイルを配るだけのサーバーを1つ立てる。
//
// このアプリにはサーバーが要らない。学習データはすべて端末の中にある。
// ここで立てるのは、ブラウザに index.html と src/*.js を読ませるためだけのもので、
// 「オフラインにする」＝配るのをやめる、という意味になる。
//
// basePath を渡すと、その下に置いたものとして配る。GitHub Pages のプロジェクトページは
// https://<名前>.github.io/study-check/ のように階層の途中に置かれるので、
// 「根元に置いたときだけ動く」作りになっていないかを、ここで実際に確かめられる。

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

export async function startTestServer({ basePath = "" } = {}) {
  let offline = false;
  // "/study-check" のような形に整える（末尾のスラッシュは付けない）。
  const base = basePath ? `/${basePath.replace(/^\/+|\/+$/g, "")}` : "";

  const server = createServer(async (request, response) => {
    if (offline) {
      request.socket.destroy();
      return;
    }
    const url = new URL(request.url, "http://localhost");
    if (base && !url.pathname.startsWith(`${base}/`) && url.pathname !== base) {
      response.writeHead(404).end();
      return;
    }
    const withoutBase = base ? url.pathname.slice(base.length) || "/" : url.pathname;
    const relative = withoutBase === "/" ? "/index.html" : withoutBase;
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
    /** アプリの入口。basePath を渡していればその下になる。 */
    appUrl: `http://127.0.0.1:${port}${base}/`,
    goOffline() { offline = true; },
    goOnline() { offline = false; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
