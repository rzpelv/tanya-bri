import { tokenize, expandQuery, displayName, synonymsOf } from "./text.mjs";

const NAME_WEIGHT = 3;

export class Bm25Index {
  constructor(entries, { k1 = 1.4, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.docs = entries.map((entry) => {
      const terms = new Map();
      const tokens = tokenize(entry.text);
      for (const t of tokens) terms.set(t, (terms.get(t) || 0) + 1);
      const size = entry.doc?.chunks || 1;
      const prior = 1 / (1 + 0.12 * Math.log10(Math.max(1, size)));
      const name = new Set(entry.doc ? tokenize(displayName(entry.doc.name)) : []);
      return { entry, terms, name, prior, length: tokens.length };
    });
    this.df = new Map();
    for (const d of this.docs)
      for (const t of new Set([...d.terms.keys(), ...d.name]))
        this.df.set(t, (this.df.get(t) || 0) + 1);
    this.avgLength =
      this.docs.reduce((sum, d) => sum + d.length, 0) / (this.docs.length || 1);
  }

  idf(term) {
    const n = this.docs.length;
    const df = this.df.get(term) || 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  // `query` is text or the result of expandQuery. Each hit reports `coverage`:
  // the idf-weighted share of the user's own terms (or their synonyms) it contains.
  search(query, limit = 20, filter) {
    const { terms, original } = typeof query === "string" ? expandQuery(query) : query;
    const groups = original.map((t) => ({
      weight: this.idf(t),
      members: [...terms.keys()].filter((s) => s === t || synonymsOf(t).includes(s)),
    }));
    const total = groups.reduce((sum, g) => sum + g.weight, 0) || 1;
    const results = [];
    for (const d of this.docs) {
      if (filter && !filter(d.entry)) continue;
      let score = 0;
      for (const [t, weight] of terms) {
        const tf = (d.terms.get(t) || 0) + (d.name.has(t) ? NAME_WEIGHT : 0);
        if (!tf) continue;
        score +=
          (weight * this.idf(t) * tf * (this.k1 + 1)) /
          (tf + this.k1 * (1 - this.b + (this.b * d.length) / this.avgLength));
      }
      if (score <= 0) continue;
      score *= d.prior;
      const covered = groups.reduce(
        (sum, g) => sum + (g.members.some((t) => d.terms.has(t) || d.name.has(t)) ? g.weight : 0),
        0,
      );
      results.push({ entry: d.entry, score, coverage: covered / total });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  nameHas(entry, term) {
    if (!this.names) this.names = new Map(this.docs.map((d) => [d.entry, d.name]));
    return this.names.get(entry)?.has(term) ?? false;
  }

  missing(original) {
    return original.filter((t) => !synonymsOf(t).some((s) => this.df.get(s)));
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

export function vectorSearch(entries, queryVector, limit = 20, filter) {
  return entries
    .filter((e) => e.vector && (!filter || filter(e)))
    .map((entry) => ({ entry, score: cosine(entry.vector, queryVector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const fingerprint = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 400);

// Reciprocal rank fusion, keeping at most `perDoc` passages per document and
// dropping passages whose text duplicates one already chosen (e.g. the same PDF uploaded twice).
export function fuse(rankings, limit = 6, { k = 60, perDoc = 2 } = {}) {
  const scores = new Map();
  for (const ranking of rankings)
    ranking.forEach(({ entry }, rank) => {
      const current = scores.get(entry) || 0;
      scores.set(entry, current + 1 / (k + rank + 1));
    });
  const perDocCount = new Map();
  const seen = new Set();
  const out = [];
  for (const [entry, score] of [...scores.entries()].sort((a, b) => b[1] - a[1])) {
    const docId = entry.doc?.id;
    const print = fingerprint(entry.text);
    if (seen.has(print)) continue;
    if (docId && (perDocCount.get(docId) || 0) >= perDoc) continue;
    seen.add(print);
    if (docId) perDocCount.set(docId, (perDocCount.get(docId) || 0) + 1);
    out.push({ entry, score });
    if (out.length >= limit) break;
  }
  return out;
}
