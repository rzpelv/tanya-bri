import { tokenize } from "./text.mjs";

export class Bm25Index {
  constructor(entries, { k1 = 1.4, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.docs = entries.map((entry) => {
      const terms = new Map();
      const tokens = tokenize(entry.text);
      for (const t of tokens) terms.set(t, (terms.get(t) || 0) + 1);
      return { entry, terms, length: tokens.length };
    });
    this.df = new Map();
    for (const d of this.docs)
      for (const t of d.terms.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
    this.avgLength =
      this.docs.reduce((sum, d) => sum + d.length, 0) / (this.docs.length || 1);
  }

  search(query, limit = 20) {
    const terms = [...new Set(tokenize(query))];
    const n = this.docs.length;
    const results = [];
    for (const d of this.docs) {
      let score = 0;
      for (const t of terms) {
        const tf = d.terms.get(t);
        if (!tf) continue;
        const df = this.df.get(t);
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score +=
          (idf * tf * (this.k1 + 1)) /
          (tf + this.k1 * (1 - this.b + (this.b * d.length) / this.avgLength));
      }
      if (score > 0) results.push({ entry: d.entry, score });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export function vectorSearch(entries, queryVector, limit = 20) {
  return entries
    .filter((e) => e.vector)
    .map((entry) => ({ entry, score: cosine(entry.vector, queryVector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function fuse(rankings, limit = 6, k = 60) {
  const scores = new Map();
  for (const ranking of rankings)
    ranking.forEach(({ entry }, rank) => {
      const current = scores.get(entry) || 0;
      scores.set(entry, current + 1 / (k + rank + 1));
    });
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([entry, score]) => ({ entry, score }));
}
