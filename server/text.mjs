const STOPWORDS = new Set(
  `yang dan di ke dari untuk dengan atau ini itu adalah pada dalam akan tidak juga oleh sebagai
  bagi dapat telah sudah harus bisa ada serta karena maka jika apabila bila agar supaya para
  tersebut setiap secara hal antara lain lainnya sesuai terhadap yaitu yakni namun tetapi
  saya aku kamu anda kami kita mereka ia dia apa siapa bagaimana berapa kapan mana mengapa kenapa
  apakah adakah sebuah suatu seorang lebih kurang paling sangat masih belum hanya pun lah kah
  nya per the of and to in a an is for on`
    .split(/\s+/)
    .filter(Boolean),
);

export function normalize(text) {
  return text
    .normalize("NFKC")
    .replace(/\u00ad/g, "")
    .replace(/(\w)-\n(\w)/g, "$1$2")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stem(word) {
  if (word.length > 5) return word.replace(/(nya|lah|kah|pun)$/, "");
  return word;
}

export function tokenize(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
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
