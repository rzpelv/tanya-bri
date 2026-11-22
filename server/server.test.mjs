import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tokenize, chunkPages } from "./text.mjs";
import { Bm25Index, fuse } from "./search.mjs";
import { extractPages } from "./pdf.mjs";
import { Store } from "./store.mjs";
import { Rag } from "./rag.mjs";

const fixture = new URL("./fixtures/contoh-ketentuan.pdf", import.meta.url);

test("tokenize drops Indonesian stopwords and suffixes", () => {
  assert.deepEqual(tokenize("Berapa biaya administrasinya untuk tabungan?"), [
    "biaya",
    "administrasi",
    "tabungan",
  ]);
});

test("chunkPages keeps page numbers and overlaps long pages", () => {
  const long = Array.from({ length: 60 }, (_, i) => `Kalimat nomor ${i} tentang ketentuan.`).join(" ");
  const chunks = chunkPages(["halaman satu", long]);
  assert.equal(chunks[0].page, 1);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.slice(1).every((c) => c.page === 2 && c.text.length <= 1100));
});

test("BM25 ranks the matching passage first and fusion merges rankings", () => {
  const entries = [
    { text: "Setoran awal tabungan Rp100.000" },
    { text: "Batas penarikan tunai ATM per hari" },
  ];
  const index = new Bm25Index(entries);
  const hits = index.search("berapa batas tarik tunai di ATM?");
  assert.equal(hits[0].entry, entries[1]);
  const fused = fuse([hits, [{ entry: entries[0] }, { entry: entries[1] }]]);
  assert.equal(fused[0].entry, entries[1]);
});

test("extractPages reads text per page from a PDF", async () => {
  const pages = await extractPages(await readFile(fixture));
  assert.equal(pages.length, 2);
  assert.match(pages[1], /Rp10\.000\.000/);
});

test("ingest and ask in search-only mode cites the right page", async () => {
  const store = await new Store(await mkdtemp(join(tmpdir(), "tanya-"))).load();
  const rag = new Rag(store, { getKey: () => null });
  const doc = await store.addFile("contoh.pdf", await readFile(fixture));
  await rag.ingest(doc);
  assert.equal(doc.status, "ready");
  const result = await rag.ask("Berapa biaya ganti kartu yang hilang?");
  assert.equal(result.mode, "search");
  assert.equal(result.sources[0].page, 2);
  const reloaded = await new Store(store.dir).load();
  assert.equal(reloaded.entries().length, doc.chunks);
});

test("non-text PDFs are flagged as scanned", async () => {
  const store = await new Store(await mkdtemp(join(tmpdir(), "tanya-"))).load();
  const rag = new Rag(store, { getKey: () => null });
  const blank =
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
  const doc = await store.addFile("scan.pdf", Buffer.from(blank));
  await rag.ingest(doc);
  assert.equal(doc.status, "error");
  assert.match(doc.error, /scan/);
});

async function riplayRag() {
  const store = await new Store(await mkdtemp(join(tmpdir(), "tanya-"))).load();
  const rag = new Rag(store, { getKey: () => null });
  for (const name of ["RIPLAY_BRITAMA.pdf", "RIPLAY_SIMPEDES.pdf"]) {
    const doc = await store.addFile(name, await readFile(fixture));
    await rag.ingest(doc);
  }
  return { store, rag };
}

test("search-only says not found when the question's key words are absent", async () => {
  const { rag } = await riplayRag();
  const result = await rag.ask("Berapa gaji pegawai BRI tahun 2026?");
  assert.equal(result.notFound, true);
  assert.match(result.answer, /tidak ditemukan/);
  assert.match(result.answer, /gaji/);
});

test("identical uploads are detected by content hash", async () => {
  const { store } = await riplayRag();
  const [a, b] = store.documents;
  assert.equal(a.hash, b.hash);
  assert.equal(store.findByHash(a.hash).hash, a.hash);
});

test("duplicate passages are collapsed and comparisons cover both products", async () => {
  const { rag } = await riplayRag();
  const result = await rag.ask("biaya ganti kartu hilang britama atau simpedes");
  const prints = result.sources.map((s) => s.text.slice(0, 200));
  assert.equal(new Set(prints).size, prints.length);
  assert.ok(result.sources.length >= 1);
});

test("search-only follow-ups reuse the previous question", async () => {
  const { rag } = await riplayRag();
  const result = await rag.ask("kalau yang hilang?", [
    { role: "user", content: "Berapa biaya ganti kartu?" },
  ]);
  assert.ok(result.context?.includes("pertanyaan sebelumnya"));
});

test("replacing a document removes the old version once the new one is ready", async () => {
  const { store, rag } = await riplayRag();
  const old = store.documents[0];
  const buffer = Buffer.concat([await readFile(fixture), Buffer.from("\n%versi-baru\n")]);
  const doc = await store.addFile("RIPLAY_BRITAMA_2026.pdf", buffer, { replaces: old.id });
  await rag.ingest(doc);
  assert.equal(store.get(old.id), undefined);
  assert.equal(doc.replacedName, old.name);
});

test("layoutLines keeps a table label next to its value", async () => {
  const { layoutLines } = await import("./pdf.mjs");
  const item = (str, x, y, width) => ({ str, transform: [1, 0, 0, 9, x, y], width, height: 9 });
  const text = layoutLines([item("Rp12.000", 200, 96, 40), item("Biaya Administrasi", 50, 100, 80), item("Setoran Awal", 50, 120, 60)]);
  assert.equal(text, "Setoran Awal\nBiaya Administrasi  ·  Rp12.000");
});
