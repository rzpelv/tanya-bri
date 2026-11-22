const STOPWORDS = new Set(
  `yang yg dan dn di ke dari untuk utk dengan dgn atau ato atw ini itu adalah pada dalam akan tidak tdk ga gak nggak engga juga oleh sebagai
  bagi dapat telah sudah udah harus bisa ada serta karena krn maka jika apabila bila kalau kalo klo agar supaya para
  tersebut setiap secara hal antara lain lainnya sesuai terhadap yaitu yakni namun tetapi tapi
  saya aku ku gue gw kamu anda kami kita mereka ia dia apa siapa bagaimana gimana gmn berapa brp brapa kapan mana mengapa kenapa
  apakah adakah sebuah suatu seorang lebih kurang paling sangat masih belum hanya pun lah kah dong sih ya yah nih deh kok
  nya per begitu gitu murah mahal beda bedanya banding dibanding dibandingkan bandingkan terus lalu halo hai tolong mohon mau ingin pengen the of and to in a an is for on what how`
    .split(/\s+/)
    .filter(Boolean),
);

// Each group is treated as interchangeable wording (Indonesian casual/formal and English).
const SYNONYM_GROUPS = [
  "minimal minimum min",
  "maksimal maksimum maks limit batas",
  "admin administrasi",
  "biaya fee tarif ongkos",
  "tutup penutupan menutup ditutup closing",
  "buka pembukaan membuka dibuka",
  "hilang ilang kehilangan lost",
  "blokir pemblokiran diblokir",
  "ganti penggantian mengganti diganti",
  "setor setoran menyetor deposit",
  "tarik penarikan menarik withdrawal",
  "syarat persyaratan requirement requirements",
  "call contact kontak",
  "atm debit",
  "kartu card",
  "bunga interest",
  "tabungan savings",
  "saldo balance",
  "nasabah customer",
  "pinjaman kredit credit loan",
  "kebijakan policy",
  "perlindungan protection",
  "komisaris commissioners commissioner",
  "direksi directors director",
  "dewan board",
  "tugas duties duty responsibilities",
  "wewenang authority authorities",
  "risiko risk",
  "laporan report",
  "tahunan annual",
  "keberlanjutan sustainability",
  "likuiditas liquidity",
  "pengungkit leverage",
  "pemegang shareholders",
  "rapat meeting",
  "anggaran articles",
  "gaji salary remunerasi remuneration",
  "pajak tax",
  "kahar majeure",
  "sanggahan sanggah dispute keberatan",
  "pengaduan keluhan complaint komplain",
  "denda penalty penalti",
  "keterlambatan terlambat telat late",
  "deadline jangka tenggat",
];

const SYNONYMS = new Map();
for (const group of SYNONYM_GROUPS) {
  const words = group.split(" ");
  for (const w of words) SYNONYMS.set(w, words.filter((o) => o !== w));
}

const SPELLING = new Map(
  Object.entries({ britma: "britama", brtama: "britama", simpedez: "simpedes", brimo: "brimo", rek: "rekening", tf: "transfer", ilang: "hilang", dipake: "digunakan", dipakai: "digunakan", pake: "pakai", setahun: "tahun", kena: "dikenakan" }),
);

export function normalize(text) {
  return text
    .normalize("NFKC")
    .replace(/\u00ad/g, "")
    .replace(/[\uf000-\uf8ff\u25aa\u25cf\u2022\u00b7\u25e6\u2023\u2043]/g, "•")
    .replace(/(\w)-\n(\w)/g, "$1$2")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stem(word) {
  if (word.length > 5) return word.replace(/(nya|lah|kah|pun)$/, "");
  return word;
}

export function words(text) {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

export function tokenize(text) {
  return words(text)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

// Query terms with weights: the user's own words count fully, synonyms partly.
export function expandQuery(text) {
  const terms = new Map();
  const original = [];
  for (let t of tokenize(text)) {
    t = SPELLING.get(t) || t;
    if (!original.includes(t)) original.push(t);
    terms.set(t, Math.max(terms.get(t) || 0, 1));
    for (const s of SYNONYMS.get(t) || []) terms.set(s, Math.max(terms.get(s) || 0, 0.7));
  }
  return { terms, original };
}

export function synonymsOf(term) {
  return [term, ...(SYNONYMS.get(term) || [])];
}

export function displayName(name) {
  return name
    .replace(/\.pdf$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function chunkPages(pages, { size = 1100, overlap = 200 } = {}) {
  const chunks = [];
  pages.forEach((raw, index) => {
    const text = normalize(raw);
    if (!text) return;
    let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + size);
      if (end < text.length) {
        const window = text.slice(start + Math.floor(size * 0.6), end);
        const cut = Math.max(
          window.lastIndexOf("\n"),
          window.lastIndexOf(". "),
          window.lastIndexOf("; "),
        );
        if (cut > 0) end = start + Math.floor(size * 0.6) + cut + 1;
      }
      const piece = text.slice(start, end).trim();
      if (piece) chunks.push({ page: index + 1, text: piece });
      if (end >= text.length) break;
      start = Math.max(end - overlap, start + 1);
      const space = text.indexOf(" ", start);
      if (space > -1 && space - start < 40) start = space + 1;
    }
  });
  return chunks;
}
