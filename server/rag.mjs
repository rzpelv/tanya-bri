import { extractPages } from "./pdf.mjs";
import { chunkPages, expandQuery, tokenize, displayName, synonymsOf } from "./text.mjs";
import { Bm25Index, vectorSearch, fuse } from "./search.mjs";
import { embed, generate } from "./gemini.mjs";
import { readFile } from "node:fs/promises";

const SYSTEM = `Kamu adalah "Tanya BRI", asisten yang menjawab pertanyaan tentang ketentuan, kebijakan, dan prosedur BRI hanya berdasarkan kutipan dokumen yang diberikan.
Aturan:
- Jawab dalam bahasa Indonesia yang jelas, sopan, dan ringkas.
- Gunakan hanya informasi dari kutipan. Jangan menambah pengetahuan dari luar dokumen.
- Cantumkan nomor sumber dalam kurung siku, misalnya [1] atau [2][3], tepat setelah kalimat yang didukungnya.
- Jika kutipan tidak memuat jawabannya, katakan terus terang bahwa informasi itu tidak ditemukan di dokumen yang diunggah. Jangan menebak.
- Boleh memakai poin-poin dan **huruf tebal** untuk angka, batas, atau syarat penting.`;

export class Rag {
  constructor(store, { getKey }) {
    this.store = store;
    this.getKey = getKey;
    this.jobs = Promise.resolve();
    this.index = null;
  }

  invalidate() {
    this.index = null;
  }

  #corpus() {
    if (!this.index) {
      const entries = this.store.entries();
      this.index = { entries, bm25: new Bm25Index(entries) };
    }
    return this.index;
  }

  enqueue(task) {
    this.jobs = this.jobs.then(task).catch((error) => console.error(error));
    return this.jobs;
  }

  ingest(doc) {
    return this.enqueue(async () => {
      try {
        const pages = await extractPages(await readFile(this.store.filePath(doc.id)));
        const chunks = chunkPages(pages);
        const chars = chunks.reduce((n, c) => n + c.text.length, 0);
        doc.pages = pages.length;
        if (chars < Math.max(80, pages.length * 20)) {
          throw new Error(
            "Teks tidak terbaca. PDF ini kemungkinan hasil scan (gambar), yang belum didukung.",
          );
        }
        await this.store.saveChunks(doc.id, chunks);
        Object.assign(doc, { status: "ready", chunks: chunks.length, error: undefined });
        if (doc.replaces && this.store.get(doc.id)) {
          const old = this.store.get(doc.replaces);
          if (old) {
            doc.replacedName = old.name;
            await this.store.remove(old.id);
          }
          doc.replaces = undefined;
        }
        this.invalidate();
        await this.store.saveDocuments();
        await this.#embedDoc(doc);
      } catch (error) {
        Object.assign(doc, {
          status: "error",
          error: error.message?.startsWith("Teks tidak")
            ? error.message
            : "PDF tidak dapat dibaca. Pastikan file tidak rusak atau terkunci kata sandi.",
        });
        console.error(`ingest ${doc.name}:`, error.message);
        await this.store.saveDocuments();
      }
    });
  }

  async #embedDoc(doc) {
    const key = this.getKey();
    if (!key || doc.embedded || doc.status !== "ready" || !this.store.get(doc.id)) return;
    const chunks = this.store.chunks.get(doc.id) || [];
    try {
      doc.embedding = true;
      const vectors = await embed(
        key,
        chunks.map((c) => `${doc.name}\n${c.text}`),
      );
      if (!this.store.get(doc.id)) return;
      chunks.forEach((c, i) => (c.vector = vectors[i]));
      await this.store.saveChunks(doc.id, chunks);
      doc.embedded = true;
      doc.embedError = undefined;
    } catch (error) {
      doc.embedError = "Indeks AI gagal dibuat; pencarian kata kunci tetap berjalan.";
      console.error(`embed ${doc.name}:`, error.message);
    } finally {
      doc.embedding = undefined;
      this.invalidate();
      await this.store.saveDocuments();
    }
  }

  embedMissing() {
    for (const doc of this.store.documents)
      if (doc.status === "ready" && !doc.embedded) this.enqueue(() => this.#embedDoc(doc));
  }

  async #standalone(key, question, history) {
    if (!history.length) return question;
    const transcript = history
      .slice(-4)
      .map((m) => `${m.role === "user" ? "Pengguna" : "Asisten"}: ${m.content.slice(0, 600)}`)
      .join("\n");
    try {
      const rewritten = await generate(key, {
        system:
          "Tulis ulang pertanyaan terakhir pengguna menjadi satu pertanyaan mandiri yang lengkap untuk pencarian dokumen. Balas hanya dengan pertanyaan itu.",
        contents: [
          {
            role: "user",
            parts: [{ text: `${transcript}\n\nPertanyaan terakhir: ${question}` }],
          },
        ],
        temperature: 0,
      });
      return rewritten || question;
    } catch {
      return question;
    }
  }

  async retrieve(question, key, { docIds, previous } = {}) {
    const { entries, bm25 } = this.#corpus();
    const filter = docIds?.length ? (e) => docIds.includes(e.doc.id) : undefined;
    const query = expandQuery(question);
    let followUp = false;
    if (previous && isFollowUp(question, query)) {
      const prev = expandQuery(previous);
      const ownProduct = query.original.some((t) => bm25.isName(t));
      for (const [t, w] of prev.terms) {
        if (query.terms.has(t) || (ownProduct && bm25.isName(t))) continue;
        query.terms.set(t, w * 0.5);
      }
      followUp = true;
    }
    const lexical = bm25.search(query, 30, filter);
    const rankings = [lexical];
    let aiError;
    if (key && entries.some((e) => e.vector)) {
      try {
        const [vector] = await embed(key, [question], "RETRIEVAL_QUERY");
        rankings.push(vectorSearch(entries, vector, 30, filter));
      } catch (error) {
        aiError = error;
      }
    }
    // Comparisons ("britama vs simpedes"): make sure each named product gets its own passages.
    const named = query.original.filter((t) => {
      const n = entries.filter((e) => bm25.nameHas(e, t)).length;
      return n > 0 && n < entries.length;
    });
    if (named.length >= 2) {
      for (const t of named) {
        const own = bm25.search(query, 2, (e) => (!filter || filter(e)) && bm25.nameHas(e, t));
        lexical.push(...own);
        rankings.unshift(own);
      }
    }
    const coverage = new Map(lexical.map((h) => [h.entry, h.coverage]));
    const hits = fuse(rankings, 5).map((h) => ({ ...h, coverage: coverage.get(h.entry) || 0 }));
    return {
      hits,
      aiError,
      query,
      followUp,
      named: named.length >= 2 ? named : [],
      missing: bm25.missing(query.original),
      best: Math.max(0, ...lexical.slice(0, 5).map((h) => h.coverage)),
    };
  }

  async ask(question, history = [], { docIds } = {}) {
    const key = this.getKey();
    if (!this.#corpus().entries.length) {
      return {
        mode: "empty",
        answer: "Belum ada dokumen yang siap. Unggah PDF ketentuan BRI terlebih dahulu.",
        sources: [],
      };
    }
    const previous = [...history].reverse().find((m) => m.role === "user")?.content;
    const standalone = key && history.length ? await this.#standalone(key, question, history) : null;
    const { hits, aiError, query, followUp, missing, best, named } = await this.retrieve(standalone || question, key, {
      docIds,
      previous: standalone ? null : previous,
    });
    const sources = hits.map(({ entry }, i) => ({
      n: i + 1,
      docId: entry.doc.id,
      docName: entry.doc.name,
      title: displayName(entry.doc.name),
      page: entry.page,
      section: sectionOf(entry.text),
      text: entry.text,
    }));
    const terms = [...query.terms.keys()];
    const context = followUp ? `Dicari bersama pertanyaan sebelumnya: "${previous.slice(0, 120)}"` : undefined;
    if (!query.original.length) {
      return {
        mode: key ? "ai" : "search",
        answer:
          "Halo! Tanyakan sesuatu tentang isi dokumen yang diunggah, misalnya biaya administrasi, saldo minimum, atau syarat pembukaan rekening.",
        sources: [],
      };
    }
    const near = Math.max(0, ...sources.slice(0, 3).map((s) => windowCoverage(s, query, named)));
    if (!sources.length || (!key && ((!named.length && best < 0.6) || near < 0.75))) {
      const absent = missing.length
        ? ` Kata "${missing.join('", "')}" tidak ada di dokumen mana pun.`
        : "";
      return {
        mode: key ? "ai" : "search",
        notFound: true,
        answer: `Informasi ini tidak ditemukan di dokumen yang diunggah.${absent} Coba kata lain, atau pastikan dokumen yang memuatnya sudah diunggah.`,
        context,
        terms,
        sources: sources.slice(0, 2),
      };
    }
    if (!key) return { mode: "search", answer: null, context, terms, highlights: highlights(sources, query), sources };
    try {
      if (aiError) throw aiError;
      const context = sources
        .map((s) => `[${s.n}] (${s.docName}, hal. ${s.page})\n${s.text}`)
        .join("\n\n");
      const contents = history.slice(-6).map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content.slice(0, 2000) }],
      }));
      contents.push({
        role: "user",
        parts: [{ text: `Kutipan dokumen:\n\n${context}\n\nPertanyaan: ${question}` }],
      });
      const answer = await generate(key, { system: SYSTEM, contents });
      return { mode: "ai", answer: answer || "Maaf, AI tidak memberikan jawaban.", terms, sources };
    } catch (error) {
      console.error("generate:", error.message);
      return {
        mode: "search",
        notice: "AI sedang tidak dapat dihubungi, jadi berikut bagian dokumen yang paling relevan.",
        answer: null,
        terms,
        highlights: highlights(sources, query),
        sources,
      };
    }
  }
}

const FOLLOW_UP = /^(kalau|kalo|klo|kl|bagaimana dengan|gimana dengan|gmn dengan|terus|lalu|trus|yang|yg|untuk yang|utk yg|dan|how about|what about)\b/i;

function isFollowUp(question, query) {
  return FOLLOW_UP.test(question.trim()) || query.original.length <= 2;
}

function sectionOf(text) {
  const lines = text.split("\n").map((l) => l.trim());
  return (
    lines.find((l) => /^(pasal|bab|article|section)\s+[\w.]+/i.test(l))?.slice(0, 80)
  );
}

const NUMERIC = /\d/;

// Share of the user's terms (or synonyms) found together within any 3 consecutive lines.
function windowCoverage(source, query, named = []) {
  const terms = query.original.filter((t) => !named.includes(t));
  if (named.length) terms.push(named);
  if (!terms.length) return 0;
  const name = tokenize(source.title);
  const lines = source.text.split("\n").map((l) => new Set(tokenize(l)));
  let best = 0;
  for (let i = 0; i < lines.length; i++) {
    const window = new Set([...name, ...lines[i], ...(lines[i + 1] || []), ...(lines[i + 2] || [])]);
    const has = (t) => (Array.isArray(t) ? t.some(has) : synonymsOf(t).some((s) => window.has(s)));
    best = Math.max(best, terms.filter(has).length / terms.length);
  }
  return best;
}

// Picks the lines that best match the question, so search-only mode can show a short answer.
function highlights(sources, query) {
  const scored = [];
  sources.slice(0, 3).forEach((s, si) => {
    const lines = s.text.split("\n");
    lines.forEach((line, li) => {
      const toks = new Set(tokenize(line));
      let score = 0;
      for (const [t, w] of query.terms) if (toks.has(t)) score += w;
      if (!score) return;
      let text = line.trim();
      if (!NUMERIC.test(text) && lines[li + 1] && NUMERIC.test(lines[li + 1]) && lines[li + 1].length < 80)
        text += ` ${lines[li + 1].trim()}`;
      if (NUMERIC.test(text)) score += 0.5;
      score -= si * 0.8;
      scored.push({ n: s.n, text: text.slice(0, 240), score });
    });
  });
  const seen = new Set();
  return scored
    .sort((a, b) => b.score - a.score)
    .filter((h) => !seen.has(h.text) && seen.add(h.text))
    .slice(0, 3);
}
