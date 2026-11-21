import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Rebuild visual lines from positioned text items so table labels stay next to their values.
export function layoutLines(items) {
  const parts = items
    .filter((it) => "str" in it && it.str.trim())
    .map((it) => {
      const [, , , d, x, y] = it.transform;
      const height = Math.abs(it.height || d) || 8;
      return { str: it.str, x, y, height, end: x + (it.width || 0) };
    })
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const part of parts) {
    const row = rows.find((r) => Math.abs(r.y - part.y) <= Math.min(r.height, part.height) * 0.45);
    if (row) row.parts.push(part);
    else rows.push({ y: part.y, height: part.height, parts: [part] });
  }
  rows.sort((a, b) => b.y - a.y);
  const overlaps = (a, b) => a.parts.some((p) => b.parts.some((q) => p.x < q.end + 2 && q.x < p.end + 2));
  const merged = [];
  for (const row of rows) {
    const last = merged[merged.length - 1];
    if (last && !last.merged && last.y - row.y < Math.max(last.height, row.height) * 1.3 && !overlaps(last, row)) {
      last.parts.push(...row.parts);
      last.merged = true;
    } else merged.push(row);
  }
  return merged
    .map((row) => {
      row.parts.sort((a, b) => a.x - b.x);
      let line = "";
      let prev = null;
      for (const p of row.parts) {
        if (prev) {
          const gap = p.x - prev.end;
          if (gap > p.height * 1.5) line += "  ·  ";
          else if (gap > p.height * 0.15 && !line.endsWith(" ") && !p.str.startsWith(" ")) line += " ";
        }
        line += p.str;
        prev = p;
      }
      return line.trim().replace(/^(•|\d+[.)])\s+·\s+/, "$1 ");
    })
    .join("\n");
}

export async function extractPages(buffer) {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(layoutLines(content.items));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}
