# Tanya BRI

Tanya BRI — asisten AI berbahasa Indonesia yang menjawab pertanyaan dari PDF ketentuan BRI yang diunggah.

Upload policy PDFs, the server extracts and indexes their text, and the chat answers questions from those documents with file and page citations.

## Run

Use Node 22 or newer (`source ~/.nvm/nvm.sh` first if Node comes from nvm).

```sh
npm ci
npm run dev          # Vite on 5173, API on 3001
npm test
npm run build && npm start   # production server on PORT (default 3000)
```

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Uploaded PDFs, extracted chunks, embeddings and settings. Keep it outside the build directory. |
| `GEMINI_API_KEY` | none | Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). Can also be entered in the app under **Pengaturan AI**. |
| `AI_BASE_URL` | none | OpenAI-compatible API (e.g. `https://router.classai.id/v1`). When set, it is used instead of Gemini. |
| `AI_API_KEY` | none | Key for `AI_BASE_URL` |
| `AI_MODEL` / `AI_EMBED_MODEL` | `claude-haiku-4.5` / `text-embedding-3-small` | Answer and embedding models for `AI_BASE_URL` |
| `AI_DAILY_LIMIT` | unlimited | Optional cap on AI answers per day; after that the app falls back to search-only until midnight UTC |
| `ACCESS_CODE` | none | Shared access code (or `accessCode` in `DATA_DIR/config.json`). When set, every API call needs a login; the browser is remembered for a year. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Answer model |
| `GEMINI_EMBED_MODEL` | `gemini-embedding-001` | Embedding model (768 dimensions) |

## How it works

1. **Upload** (`POST /api/documents`): identical files are refused (SHA-256), `?replace=<id>` uploads a new version that removes the old one once it is indexed. The PDF is stored in `DATA_DIR/files`, text is extracted per page with pdf.js (rebuilt line by line from text positions so table labels stay next to their values), and split into ~1,100-character overlapping chunks that keep their page number.
2. **Index**: chunks are searchable right away with BM25 keyword search (Indonesian stopwords, casual/formal and Indonesian/English synonyms, file-name boost, a mild penalty for very long documents). With a Gemini key, each chunk is also embedded; documents uploaded before a key was set are embedded once the key is saved.
3. **Ask** (`POST /api/chat`): follow-up questions are rewritten into standalone queries, keyword and vector results are merged with reciprocal rank fusion, at most 2 passages per document with duplicates dropped, and the top 5 passages go to Gemini with instructions to answer only from them and cite `[n]`.

Without a key the app runs in **mode pencarian**: it shows the best-matching lines with highlights, then the passages. It says "tidak ditemukan" when the question's words are missing or never appear together in one place, and short follow-ups ("kalau simpedes?") are searched together with the previous question. Questions can be limited to one document. If Gemini fails, it falls back to the same view.

## Limits of this first version

- Scanned (image-only) PDFs are rejected; there is no OCR yet.
- One shared library for everyone who can open the app; no login or per-user documents.
- Chat history lives only in the browser's localStorage.
- Storage is JSON files with an in-memory index, sized for hundreds of documents, not millions of pages.
