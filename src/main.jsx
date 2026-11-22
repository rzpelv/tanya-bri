import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  KeyRound,
  Loader2,
  Menu,
  RefreshCw,
  MessageSquarePlus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api, fileUrl, displayName } from "./api.js";
import { Markdown } from "./markdown.jsx";
import "./style.css";

const STORAGE_KEY = "tanya-bri:chat";
const SUGGESTIONS = [
  "Apa saja syarat pembukaan rekening?",
  "Berapa batas penarikan tunai harian?",
  "Bagaimana prosedur jika kartu hilang?",
  "Apa saja biaya administrasi yang berlaku?",
];

const formatSize = (bytes) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

function loadMessages() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function DocumentItem({ doc, onRemove, onReplace }) {
  let state;
  if (doc.status === "processing")
    state = (
      <span className="doc-state busy">
        <Loader2 size={13} className="spin" /> Membaca PDF…
      </span>
    );
  else if (doc.status === "error")
    state = (
      <span className="doc-state error">
        <AlertTriangle size={13} /> {doc.error}
      </span>
    );
  else
    state = (
      <span className="doc-state">
        {doc.pages} hal. · {formatSize(doc.size)}
        {doc.embedding ? (
          <>
            {" "}· <Loader2 size={12} className="spin" /> indeks AI
          </>
        ) : doc.embedded ? (
          <>
            {" "}· <Sparkles size={12} /> AI
          </>
        ) : null}
      </span>
    );
  return (
    <li className="doc">
      <div className="doc-icon">
        <FileText size={18} />
      </div>
      <div className="doc-body">
        {doc.status === "ready" ? (
          <a href={`/api/documents/${doc.id}/file`} target="_blank" rel="noreferrer" className="doc-name" title={doc.name}>
            {displayName(doc.name)}
          </a>
        ) : (
          <span className="doc-name" title={doc.name}>{displayName(doc.name)}</span>
        )}
        {state}
        {doc.replacedName && <span className="doc-state">Menggantikan {displayName(doc.replacedName)}</span>}
      </div>
      {doc.status === "ready" && (
        <button
          type="button"
          className="icon-button subtle"
          aria-label={`Ganti versi ${doc.name}`}
          title="Ganti dengan versi baru"
          onClick={() => onReplace(doc)}
        >
          <RefreshCw size={15} />
        </button>
      )}
      <button
        type="button"
        className="icon-button subtle"
        title="Hapus"
        aria-label={`Hapus ${doc.name}`}
        onClick={() => onRemove(doc)}
      >
        <Trash2 size={16} />
      </button>
    </li>
  );
}

function Highlight({ text, terms }) {
  if (!terms?.length) return text;
  const set = new Set(terms);
  return text.split(/([\p{L}\p{N}]+)/u).map((part, i) => {
    const w = part.toLowerCase();
    const stem = w.length > 5 ? w.replace(/(nya|lah|kah|pun)$/, "") : w;
    return set.has(stem) ? <mark key={i}>{part}</mark> : part;
  });
}

function Sources({ sources, open, setOpen, expandAll, terms, known }) {
  if (!sources?.length) return null;
  return (
    <div className="sources">
      {sources.map((s) => {
        const isOpen = expandAll && s.n === 1 ? !open.has(-s.n) : open.has(s.n);
        const toggle = () =>
          setOpen((prev) => {
            const next = new Set(prev);
            const id = expandAll && s.n === 1 ? -s.n : s.n;
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
          });
        return (
          <div key={s.n} id={`src-${s.n}`} className={`source ${isOpen ? "open" : ""}`}>
            <button type="button" className="source-head" onClick={toggle} aria-expanded={isOpen}>
              <span className="source-n">{s.n}</span>
              <span className="source-title">
                {s.title || displayName(s.docName)} <span className="muted">· hal. {s.page}{s.section ? ` · ${s.section}` : ""}</span>
              </span>
              <ChevronDown size={16} className="chev" />
            </button>
            {isOpen && (
              <div className="source-body">
                <p><Highlight text={s.text} terms={terms} /></p>
                {known && !known.has(s.docId) ? (
                  <span className="muted small">Dokumen ini sudah dihapus dari pustaka.</span>
                ) : (
                  <a href={fileUrl(s)} target="_blank" rel="noreferrer">
                    Buka PDF di halaman {s.page}
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AssistantMessage({ message, known }) {
  const [open, setOpen] = useState(() => new Set());
  const ref = useRef(null);
  const searchOnly = message.mode === "search";
  const cite = (n) => {
    setOpen((prev) => new Set(prev).add(n));
    requestAnimationFrame(() =>
      ref.current?.querySelector(`#src-${n}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  };
  return (
    <div className="message assistant" ref={ref}>
      {message.error ? (
        <p className="error-text">
          <AlertTriangle size={15} /> {message.error}
        </p>
      ) : searchOnly ? (
        <>
          {message.notice && <p className="notice">{message.notice}</p>}
          {message.context && <p className="muted small context">{message.context}</p>}
          {message.content ? (
            <p className={message.notFound ? "not-found" : ""}>{message.content}</p>
          ) : null}
          {message.highlights?.length > 0 && (
            <div className="quick">
              <p className="search-lead">
                <Search size={15} /> Kutipan paling cocok
              </p>
              <ul>
                {message.highlights.map((h, i) => (
                  <li key={i}>
                    <Highlight text={h.text} terms={message.terms} />{" "}
                    <button type="button" className="cite" onClick={() => cite(h.n)}>
                      {h.n}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {message.sources?.length > 0 && (
            <p className="sources-label">
              {message.notFound ? "Bagian terdekat (bukan jawaban):" : "Sumber"}
            </p>
          )}
        </>
      ) : (
        <Markdown text={message.content} onCite={cite} />
      )}
      {message.sources?.length > 0 && !searchOnly && <p className="sources-label">Sumber</p>}
      <Sources
        sources={message.sources}
        open={open}
        setOpen={setOpen}
        expandAll={searchOnly && !message.notFound}
        terms={message.terms}
        known={known}
      />
    </div>
  );
}

function SettingsDialog({ status, onClose, onChange }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onChange(await api.saveKey(key));
      setKey("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      onChange(await api.removeKey());
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Pengaturan" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Pengaturan AI</h2>
          <button type="button" className="icon-button subtle" onClick={onClose} aria-label="Tutup">
            <X size={18} />
          </button>
        </div>
        {status?.ai ? (
          <p className="pill ok">
            <Check size={14} /> AI aktif · {status.model}
          </p>
        ) : (
          <p className="pill warn">
            <Search size={14} /> Mode pencarian (AI belum aktif)
          </p>
        )}
        <p className="muted small">
          Tanpa API key, Tanya BRI tetap mencari dan menampilkan bagian PDF yang paling relevan. Dengan
          Gemini API key, jawaban dirangkum oleh AI lengkap dengan sumbernya.
        </p>
        {status?.keySource === "env" ? (
          <p className="small">API key sudah diatur di server.</p>
        ) : (
          <form onSubmit={save} className="key-form">
            <label htmlFor="key">Gemini API key</label>
            <input
              id="key"
              type="password"
              autoComplete="off"
              placeholder={status?.keySource === "app" ? "Sudah tersimpan — isi untuk mengganti" : "AIza…"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <p className="muted small">
              Buat gratis di{" "}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                Google AI Studio
              </a>
              . Key disimpan di server aplikasi, tidak ditampilkan lagi.
            </p>
            {error && <p className="error-text small">{error}</p>}
            <div className="row">
              {status?.keySource === "app" && (
                <button type="button" className="button ghost" onClick={remove} disabled={busy}>
                  Hapus key
                </button>
              )}
              <button type="submit" className="button" disabled={busy || !key.trim()}>
                {busy ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />} Simpan & uji
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function App() {
  const [documents, setDocuments] = useState([]);
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState(loadMessages);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState("");
  const [scope, setScope] = useState("");
  const [replacing, setReplacing] = useState(null);
  const fileInput = useRef(null);
  const replaceInput = useRef(null);
  const endRef = useRef(null);
  const textRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      setDocuments(await api.documents());
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    api.status().then(setStatus).catch(() => {});
  }, [refresh]);

  const pending = documents.some((d) => d.status === "processing" || d.embedding);
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, [pending, refresh]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-60)));
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, asking]);

  const ready = documents.filter((d) => d.status === "ready");
  const activeScope = ready.some((d) => d.id === scope) ? scope : "";

  const upload = async (files, replace) => {
    const all = [...files];
    const pdfs = all.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    const errors = all
      .filter((f) => !pdfs.includes(f))
      .map((f) => `${f.name}: bukan PDF. Hanya file PDF yang bisa diunggah.`);
    setUploadError(errors.join("\n"));
    for (const file of pdfs) {
      setUploading((n) => n + 1);
      try {
        await api.upload(file, replace);
      } catch (e) {
        errors.push(`${file.name}: ${e.message}`);
        setUploadError(errors.join("\n"));
      } finally {
        setUploading((n) => n - 1);
        refresh();
      }
    }
  };

  const remove = async (doc) => {
    if (!confirm(`Hapus "${doc.name}" dari pustaka?`)) return;
    await api.remove(doc.id).catch(() => {});
    if (scope === doc.id) setScope("");
    refresh();
  };

  const replace = (doc) => {
    setReplacing(doc);
    replaceInput.current?.click();
  };

  const ask = async (text) => {
    const question = text.trim();
    if (!question || asking || !ready.length) return;
    const history = messages
      .filter((m) => !m.error && (m.role === "user" || m.mode === "ai"))
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setAsking(true);
    try {
      const result = await api.ask(question, history, activeScope ? [activeScope] : []);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: result.answer || "",
          mode: result.mode,
          notice: result.notice,
          notFound: result.notFound,
          context: result.context,
          terms: result.terms,
          highlights: result.highlights,
          sources: result.sources,
        },
      ]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", error: e.message }]);
    } finally {
      setAsking(false);
      textRef.current?.focus();
    }
  };

  const known = new Set(documents.map((d) => d.id));
  const query = filter.trim().toLowerCase();
  const shown = query
    ? documents.filter((d) => d.name.toLowerCase().replace(/_/g, " ").includes(query))
    : documents;

  const sidebar = (
    <aside
      className={`sidebar ${drawer ? "open" : ""} ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        upload(e.dataTransfer.files);
      }}
    >
      <div className="brand">
        <img src="/icon.svg" alt="" width="36" height="36" />
        <div>
          <strong>Tanya BRI</strong>
          <span>Asisten ketentuan dari PDF</span>
        </div>
        <button type="button" className="icon-button subtle only-mobile" onClick={() => setDrawer(false)} aria-label="Tutup">
          <X size={18} />
        </button>
      </div>
      <button type="button" className="button wide" onClick={() => fileInput.current?.click()}>
        {uploading ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
        {uploading ? "Mengunggah…" : "Unggah PDF"}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          upload(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={replaceInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          if (e.target.files[0] && replacing) upload([e.target.files[0]], replacing.id);
          setReplacing(null);
          e.target.value = "";
        }}
      />
      <div className="section-label">
        Pustaka dokumen{" "}
        <span>{ready.length === documents.length ? ready.length : `${ready.length} siap / ${documents.length}`}</span>
      </div>
      {documents.length > 5 && (
        <input
          className="doc-filter"
          type="search"
          placeholder="Cari dokumen…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      {documents.length ? (
        <ul className="docs">
          {shown.map((d) => (
            <DocumentItem key={d.id} doc={d} onRemove={remove} onReplace={replace} />
          ))}
          {!shown.length && <li className="muted small">Tidak ada dokumen yang cocok.</li>}
        </ul>
      ) : (
        <p className="muted small empty-docs">
          Belum ada dokumen. Unggah PDF ketentuan, SOP, atau surat edaran BRI. Bisa juga seret file ke sini.
        </p>
      )}
      <div className="sidebar-foot">
        <button type="button" className="link-button" onClick={() => setSettings(true)}>
          <Settings size={15} /> Pengaturan AI
        </button>
        <a className="link-button" href="https://app.devin.ai/sessions/64879c29be2b40558e9c7dba1b49ef56" target="_blank" rel="noreferrer">
          Minta perubahan
        </a>
      </div>
    </aside>
  );

  return (
    <div className="app">
      {sidebar}
      {drawer && <div className="scrim only-mobile" onClick={() => setDrawer(false)} />}
      <main className="chat">
        <header className="topbar">
          <button type="button" className="icon-button only-mobile" onClick={() => setDrawer(true)} aria-label="Dokumen">
            <Menu size={20} />
          </button>
          <h1>Tanya BRI</h1>
          <button type="button" className={`mode ${status?.ai ? "on" : ""}`} onClick={() => setSettings(true)}>
            {status?.ai ? <Sparkles size={14} /> : <Search size={14} />}
            {status ? (status.ai ? "AI aktif" : "Mode pencarian") : "…"}
          </button>
          {messages.length > 0 && (
            <button type="button" className="icon-button subtle" onClick={() => setMessages([])} aria-label="Percakapan baru" title="Percakapan baru">
              <MessageSquarePlus size={19} />
            </button>
          )}
        </header>
        {uploadError && (
          <div className="toast" role="alert">
            <AlertTriangle size={16} />
            <span>{uploadError}</span>
            <button type="button" className="icon-button subtle" onClick={() => setUploadError("")} aria-label="Tutup">
              <X size={16} />
            </button>
          </div>
        )}
        <div className="thread">
          {messages.length === 0 ? (
            <div className="welcome">
              <img src="/icon.svg" alt="" width="64" height="64" />
              <h2>Tanya apa saja tentang ketentuan BRI</h2>
              <p className="muted">
                Jawaban diambil dari PDF di pustaka dokumen, lengkap dengan nama file dan halaman sumbernya.
              </p>
              {ready.length ? (
                <div className="suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => ask(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              ) : (
                <button type="button" className="button" onClick={() => fileInput.current?.click()}>
                  <Upload size={16} /> Unggah PDF pertama
                </button>
              )}
              {status && !status.ai && (
                <p className="notice">
                  AI belum aktif: sementara ini Tanya BRI menampilkan bagian dokumen yang paling relevan.{" "}
                  <button type="button" className="inline-link" onClick={() => setSettings(true)}>
                    Aktifkan AI
                  </button>
                </p>
              )}
            </div>
          ) : (
            messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="message user">
                  {m.content}
                </div>
              ) : (
                <AssistantMessage key={i} message={m} known={known} />
              ),
            )
          )}
          {asking && (
            <div className="message assistant typing">
              <Loader2 size={16} className="spin" /> {status?.ai ? "Membaca dokumen dan menyusun jawaban…" : "Mencari di dokumen…"}
            </div>
          )}
          <div ref={endRef} />
        </div>
        {ready.length > 1 && (
          <div className="scope">
            <label htmlFor="scope">Cari di</label>
            <select id="scope" value={activeScope} onChange={(e) => setScope(e.target.value)}>
              <option value="">Semua dokumen ({ready.length})</option>
              {ready.map((d) => (
                <option key={d.id} value={d.id}>
                  {displayName(d.name)}
                </option>
              ))}
            </select>
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <textarea
            ref={textRef}
            rows={1}
            value={input}
            disabled={!ready.length}
            placeholder={ready.length ? "Tulis pertanyaan…" : "Unggah PDF dulu untuk mulai bertanya"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask(input);
              }
            }}
          />
          <button type="submit" className="send" disabled={!input.trim() || asking || !ready.length} aria-label="Kirim">
            <ArrowUp size={18} />
          </button>
        </form>
        <p className="disclaimer">Periksa kembali jawaban dengan dokumen sumber sebelum digunakan.</p>
      </main>
      {settings && <SettingsDialog status={status} onClose={() => setSettings(false)} onChange={setStatus} />}
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
