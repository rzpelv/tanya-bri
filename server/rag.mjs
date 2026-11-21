import { extractPages } from "./pdf.mjs";
import { chunkPages } from "./text.mjs";
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

  async retrieve(query, key) {
    const { entries, bm25 } = this.#corpus();
    const rankings = [bm25.search(query, 20)];
    let aiError;
    if (key && entries.some((e) => e.vector)) {
      try {
        const [vector] = await embed(key, [query], "RETRIEVAL_QUERY");
        rankings.push(vectorSearch(entries, vector, 20));
      } catch (error) {
        aiError = error;
      }
    }
    return { hits: fuse(rankings, 6), aiError };
  }

  async ask(question, history = []) {
    const key = this.getKey();
    if (!this.#corpus().entries.length) {
      return {
        mode: "empty",
        answer: "Belum ada dokumen yang siap. Unggah PDF ketentuan BRI terlebih dahulu.",
        sources: [],
      };
    }
    const query = key ? await this.#standalone(key, question, history) : question;
    const { hits, aiError } = await this.retrieve(query, key);
    const sources = hits.map(({ entry }, i) => ({
      n: i + 1,
      docId: entry.doc.id,
      docName: entry.doc.name,
      page: entry.page,
      text: entry.text,
    }));
    if (!sources.length) {
      return {
        mode: key ? "ai" : "search",
        answer: "Tidak ditemukan bagian dokumen yang cocok dengan pertanyaan ini. Coba gunakan kata kunci lain.",
        sources: [],
      };
    }
    if (!key) return { mode: "search", answer: null, sources };
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
      return { mode: "ai", answer: answer || "Maaf, AI tidak memberikan jawaban.", sources };
    } catch (error) {
      console.error("generate:", error.message);
      return {
        mode: "search",
        notice: "AI sedang tidak dapat dihubungi, jadi berikut bagian dokumen yang paling relevan.",
        answer: null,
        sources,
      };
    }
  }
}
