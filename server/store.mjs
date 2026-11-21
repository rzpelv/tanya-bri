import { mkdir, readFile, writeFile, rename, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";

export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.documents = [];
    this.chunks = new Map();
    this.config = {};
    this.queue = Promise.resolve();
  }

  async load() {
    await mkdir(join(this.dir, "files"), { recursive: true });
    await mkdir(join(this.dir, "chunks"), { recursive: true });
    this.documents = (await this.#read("db.json"))?.documents || [];
    this.config = (await this.#read("config.json")) || {};
    for (const doc of this.documents) {
      if (doc.status === "processing") {
        doc.status = "error";
        doc.error = "Pemrosesan terputus. Hapus lalu unggah ulang dokumen ini.";
      }
      if (!doc.hash)
        doc.hash = await readFile(this.filePath(doc.id)).then(sha256, () => undefined);
      if (doc.status === "ready")
        this.chunks.set(doc.id, (await this.#read(`chunks/${doc.id}.json`)) || []);
    }
    return this;
  }

  async #read(name) {
    try {
      return JSON.parse(await readFile(join(this.dir, name), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  #write(name, value, mode) {
    this.queue = this.queue.then(async () => {
      const file = join(this.dir, name);
      const tmp = `${file}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(value), mode ? { mode } : undefined);
      await rename(tmp, file);
      if (mode) await chmod(file, mode);
    });
    return this.queue;
  }

  saveDocuments() {
    return this.#write("db.json", { documents: this.documents });
  }

  saveConfig() {
    return this.#write("config.json", this.config, 0o600);
  }

  saveChunks(id, chunks) {
    this.chunks.set(id, chunks);
    return this.#write(`chunks/${id}.json`, chunks);
  }

  filePath(id) {
    return join(this.dir, "files", `${id}.pdf`);
  }

  findByHash(hash) {
    return this.documents.find((d) => d.hash === hash && d.status !== "error");
  }

  async addFile(name, buffer, { replaces } = {}) {
    const doc = {
      id: randomUUID(),
      name,
      hash: sha256(buffer),
      ...(replaces ? { replaces } : {}),
      size: buffer.length,
      createdAt: new Date().toISOString(),
      status: "processing",
      pages: 0,
      chunks: 0,
      embedded: false,
    };
    await writeFile(this.filePath(doc.id), buffer);
    this.documents.unshift(doc);
    await this.saveDocuments();
    return doc;
  }

  get(id) {
    return this.documents.find((d) => d.id === id);
  }

  async remove(id) {
    this.documents = this.documents.filter((d) => d.id !== id);
    this.chunks.delete(id);
    await this.saveDocuments();
    await this.queue;
    await rm(this.filePath(id), { force: true });
    await rm(join(this.dir, "chunks", `${id}.json`), { force: true });
  }

  entries() {
    const out = [];
    for (const doc of this.documents) {
      if (doc.status !== "ready") continue;
      for (const chunk of this.chunks.get(doc.id) || [])
        out.push({ ...chunk, doc });
    }
    return out;
  }
}
