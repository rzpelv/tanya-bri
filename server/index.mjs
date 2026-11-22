import http from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, sha256 } from "./store.mjs";
import { Rag } from "./rag.mjs";
import { embed, CHAT_MODEL } from "./gemini.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const staticRoot = resolve(process.env.STATIC_DIR || join(here, "..", "dist"));
const dataDir = resolve(process.env.DATA_DIR || join(here, "..", "data"));
const MAX_UPLOAD = 50 * 1024 * 1024;

const store = await new Store(dataDir).load();
const envKey = process.env.GEMINI_API_KEY?.trim();
const getKey = () => envKey || store.config.geminiKey || null;
const rag = new Rag(store, { getKey });
rag.embedMissing();

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".webmanifest": "application/manifest+json",
};

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("Ukuran file melebihi 50 MB.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  try {
    return JSON.parse((await readBody(req, 1024 * 1024)).toString("utf8") || "{}");
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error("Permintaan tidak valid."), { status: 400 });
  }
}

const publicDoc = ({ embedding, ...doc }) => ({ ...doc, embedding: Boolean(embedding) });

function status() {
  return {
    ai: Boolean(getKey()),
    keySource: envKey ? "env" : store.config.geminiKey ? "app" : null,
    model: CHAT_MODEL,
  };
}

async function api(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (pathname === "/api/status" && method === "GET") return send(res, 200, status());

  if (pathname === "/api/documents" && method === "GET")
    return send(res, 200, { documents: store.documents.map(publicDoc) });

  if (pathname === "/api/documents" && method === "POST") {
    const name = decodeURIComponent(req.headers["x-filename"] || "dokumen.pdf").slice(0, 200);
    const buffer = await readBody(req, MAX_UPLOAD);
    if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-")
      return send(res, 400, { error: "File ini bukan PDF." });
    const replaces = url.searchParams.get("replace") || undefined;
    if (replaces && !store.get(replaces))
      return send(res, 404, { error: "Dokumen yang mau diganti tidak ditemukan." });
    const duplicate = store.findByHash(sha256(buffer));
    if (duplicate && duplicate.id !== replaces)
      return send(res, 409, { error: `File ini sudah ada di pustaka sebagai "${duplicate.name}".` });
    if (duplicate) return send(res, 409, { error: "File pengganti sama persis dengan versi lama." });
    const doc = await store.addFile(name, buffer, { replaces });
    rag.ingest(doc);
    return send(res, 201, { document: publicDoc(doc) });
  }

  const match = pathname.match(/^\/api\/documents\/([\w-]+)(\/file)?$/);
  if (match) {
    const doc = store.get(match[1]);
    if (!doc && match[2] && method === "GET") {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Dokumen sudah dihapus</title><body style="font-family:system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1c2b3d"><h1 style="font-size:1.4rem">Dokumen sudah dihapus</h1><p>PDF yang dikutip jawaban ini sudah dihapus dari pustaka Tanya BRI. Unggah ulang dokumennya bila masih diperlukan.</p><p><a href="/" style="color:#0a3d7a">Kembali ke Tanya BRI</a></p></body>`,
      );
    }
    if (!doc) return send(res, 404, { error: "Dokumen tidak ditemukan." });
    if (match[2] && method === "GET") {
      const file = store.filePath(doc.id);
      const { size } = await stat(file);
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": size,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
        "X-Content-Type-Options": "nosniff",
      });
      return createReadStream(file).pipe(res);
    }
    if (!match[2] && method === "DELETE") {
      await store.remove(doc.id);
      rag.invalidate();
      return send(res, 200, { ok: true });
    }
  }

  if (pathname === "/api/chat" && method === "POST") {
    const { question, history, docIds } = await readJson(req);
    const text = String(question || "").trim().slice(0, 2000);
    if (!text) return send(res, 400, { error: "Pertanyaan kosong." });
    const turns = Array.isArray(history)
      ? history
          .filter((m) => m && typeof m.content === "string" && m.content.trim())
          .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }))
      : [];
    const scope = Array.isArray(docIds) ? docIds.filter((id) => typeof id === "string").slice(0, 50) : [];
    return send(res, 200, await rag.ask(text, turns, { docIds: scope }));
  }

  if (pathname === "/api/settings/key" && method === "PUT") {
    const { key } = await readJson(req);
    const value = String(key || "").trim();
    if (!/^[\w-]{20,200}$/.test(value))
      return send(res, 400, { error: "Format API key tidak valid." });
    try {
      await embed(value, ["tes"], "RETRIEVAL_QUERY");
    } catch (error) {
      return send(res, 400, { error: `API key ditolak Gemini: ${error.message}` });
    }
    store.config.geminiKey = value;
    await store.saveConfig();
    rag.embedMissing();
    return send(res, 200, status());
  }

  if (pathname === "/api/settings/key" && method === "DELETE") {
    delete store.config.geminiKey;
    await store.saveConfig();
    return send(res, 200, status());
  }

  send(res, 404, { error: "Tidak ditemukan." });
}

async function serveStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname);
  let file = resolve(staticRoot, "." + pathname);
  if (!file.startsWith(staticRoot + "/") && file !== staticRoot) {
    res.writeHead(403);
    return res.end();
  }
  let body;
  try {
    body = await readFile(file);
  } catch {
    file = join(staticRoot, "index.html");
    body = await readFile(file).catch(() => null);
    if (!body) {
      res.writeHead(404);
      return res.end("Tidak ditemukan");
    }
  }
  res.writeHead(200, {
    "Content-Type": types[extname(file)] || "application/octet-stream",
    "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      return await serveStatic(req, res, url);
    } catch (error) {
      console.error(error);
      if (!res.headersSent)
        send(res, error.status || 500, { error: error.status ? error.message : "Terjadi kesalahan di server." });
      else res.end();
    }
  })
  .listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
    console.log(`Tanya BRI is serving on ${process.env.PORT || 3000}`),
  );
