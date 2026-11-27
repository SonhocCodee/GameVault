// Development-only preview. No production database, credentials or user files are used.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import worker from "../worker/src/index.ts";
import {
  createTestWorkerEnv,
  createTestSessionToken,
} from "../tests/test-helpers-cloudflare.js";

const { env, d1 } = await createTestWorkerEnv({
  env: { ALLOW_MOCK_AUTH: "false" },
});
const root = path.resolve(process.env.GAMEVAULT_PREVIEW_ASSETS || "worker/admin-assets");
env.ASSETS = {
  fetch: async (request) => {
    const url = new URL(typeof request === "string" ? request : request.url),
      file = path.resolve(root, "." + decodeURIComponent(url.pathname));
    if (
      !file.startsWith(root + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    )
      return new Response("Not found", { status: 404 });
    const ext = path.extname(file),
      types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      };
    let bytes = fs.readFileSync(file);
    if (ext === ".html")
      bytes = Buffer.from(
        bytes
          .toString("utf8")
          .replace(
            "<body>",
            '<body><aside style="padding:8px 16px;background:#33250d;color:#ffdfa1;font:13px system-ui">Dữ liệu kiểm thử local — không phải cộng đồng thật.</aside>',
          ),
      );
    return new Response(bytes, {
      headers: { "Content-Type": types[ext] || "application/octet-stream" },
    });
  },
};
const users = [
  ["preview-user", "Minh (kiểm thử)", 1200],
  ["preview-two", "Linh (kiểm thử)", 900],
  ["preview-three", "An (kiểm thử)", 600],
];
for (const [uid, nickname, minutes] of users) {
  d1.sqlite
    .prepare("INSERT INTO users(uid,email,display_name) VALUES (?,?,?)")
    .run(uid, "preview@example.test", nickname);
  d1.sqlite
    .prepare(
      "INSERT INTO community_profiles(uid,nickname,share_library,avatar_preset,banner_preset) VALUES (?,?,1,?,?)",
    )
    .run(uid, nickname, uid === "preview-two" ? "dice" : "gamepad", uid === "preview-user" ? null : "aurora");
  d1.sqlite
    .prepare(
      "INSERT INTO community_library(uid,game_key,title,steam_id,status,playtime_minutes) VALUES (?,'814380','Sekiro: Shadows Die Twice',814380,'completed',?)",
    )
    .run(uid, minutes);
  d1.sqlite
    .prepare(
      "INSERT INTO ratings(id,uid,game_key,game_title,score,review) VALUES (?,?,'814380','Sekiro: Shadows Die Twice',9,'Preview review — synthetic test data.')",
    )
    .run(`review-${uid}`, uid);
}
d1.sqlite
  .prepare(
    "INSERT INTO game_covers(game_key,title,steam_id,cover_url,banner_url) VALUES ('814380','Sekiro: Shadows Die Twice',814380,'https://example.test/community/profile-presets/banners/velocity.svg','https://example.test/community/profile-presets/banners/velocity.svg')",
  )
  .run();
d1.sqlite
  .prepare(
    "INSERT INTO community_posts(id,uid,game_key,game_title,kind,body) VALUES ('preview-post','preview-two','814380','Sekiro: Shadows Die Twice','thought','Preview post — synthetic test data. The combat finally clicked after learning to deflect.')",
  )
  .run();
d1.sqlite.prepare("INSERT INTO community_steam_cache(key,value,expires_at) VALUES ('details-v2:814380',?,?)")
  .run(JSON.stringify({
    gameKey: "814380", title: "Sekiro: Shadows Die Twice", steamId: 814380,
    coverUrl: "https://example.test/community/profile-presets/banners/velocity.svg", minimum: null, recommended: null,
    sourceUrl: null, fetchedAt: new Date().toISOString(), available: false,
    description: "Dữ liệu kiểm thử local — không phải thông tin Steam thật.",
  }), Math.floor(Date.now() / 1000) + 3600);
const report = {
  gameKey: "814380",
  title: "Sekiro: Shadows Die Twice",
  completionStatus: "completed",
  cpu: "AMD Ryzen 5 5600",
  gpu: "NVIDIA GeForce RTX 3060",
  ramGb: 16,
  fpsAverage: 60,
  fpsLow: 52,
  samples: 0,
  source: "manual",
  measuredAt: "2026-11-24T10:00:00Z",
  graphics: {
    width: 1920,
    height: 1080,
    preset: "High",
    upscaling: "Off",
    frameGeneration: "Off",
    rayTracing: "Off",
    source: "manual",
  },
  notes: "Synthetic preview fixture; not a real benchmark.",
};
d1.sqlite
  .prepare(
    "INSERT INTO community_performance(id,uid,game_key,game_title,data_json) VALUES ('preview-performance','preview-two','814380','Sekiro: Shadows Die Twice',?)",
  )
  .run(JSON.stringify(report));
const token = await createTestSessionToken(
  {
    uid: "preview-user",
    email: "preview@example.test",
    displayName: "Minh (kiểm thử)",
  },
  env.SESSION_SECRET,
);
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/preview-login") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        '<!doctype html><html lang="vi"><meta charset="UTF-8"><title>Local preview login</title><body><p>Disposable local test account. No Google account is used.</p><form method="post" action="/preview-signin"><button>Đăng nhập tài khoản kiểm thử</button></form></body></html>',
      );
      return;
    }
    if (req.url === "/preview-signin") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<script>localStorage.setItem('gamevault.community.session',${JSON.stringify(token)});location.replace('/community/');</script>`,
      );
      return;
    }
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1100000) {
        res.writeHead(413);
        res.end();
        return;
      }
      parts.push(chunk);
    }
    const request = new Request(`http://127.0.0.1:8787${req.url}`, {
      method: req.method,
      headers: req.headers,
      ...(["GET", "HEAD"].includes(req.method)
        ? {}
        : { body: Buffer.concat(parts) }),
    });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end("Preview failed");
  }
});
server.listen(8787, "127.0.0.1", () =>
  console.log("Local isolated preview: http://127.0.0.1:8787/community/"),
);
