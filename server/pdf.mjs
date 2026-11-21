import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

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
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str;
        text += item.hasEOL ? "\n" : item.str.endsWith(" ") ? "" : " ";
      }
      pages.push(text);
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}
