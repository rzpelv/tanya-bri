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
  MessageSquarePlus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api, fileUrl } from "./api.js";
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

function DocumentItem({ doc, onRemove }) {
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
          <a href={`/api/documents/${doc.id}/file`} target="_blank" rel="noreferrer" className="doc-name">
            {doc.name}
          </a>
        ) : (
          <span className="doc-name">{doc.name}</span>
        )}
        {state}
      </div>
      <button
        type="button"
        className="icon-button subtle"
        aria-label={`Hapus ${doc.name}`}
        onClick={() => onRemove(doc)}
      >
        <Trash2 size={16} />
      </button>
    </li>
  );
}

function Sources({ sources, open, setOpen, expandAll }) {
  if (!sources?.length) return null;
  return (
    <div className="sources">
      {sources.map((s) => {
        const isOpen = expandAll ? !open.has(-s.n) : open.has(s.n);
        const toggle = () =>
          setOpen((prev) => {
            const next = new Set(prev);
            const id = expandAll ? -s.n : s.n;
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
          });
        return (
          <div key={s.n} id={`src-${s.n}`} className={`source ${isOpen ? "open" : ""}`}>
            <button type="button" className="source-head" onClick={toggle} aria-expanded={isOpen}>
              <span className="source-n">{s.n}</span>
              <span className="source-title">
                {s.docName} <span className="muted">· hal. {s.page}</span>
              </span>
              <ChevronDown size={16} className="chev" />
            </button>
            {isOpen && (
              <div className="source-body">
                <p>{s.text}</p>
                <a href={fileUrl(s)} target="_blank" rel="noreferrer">
                  Buka PDF di halaman {s.page}
                </a>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AssistantMessage({ message }) {
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
          <p className="search-lead">
            <Search size={15} /> Bagian dokumen yang paling relevan:
          </p>
        </>
      ) : (
        <Markdown text={message.content} onCite={cite} />
      )}
      {message.sources?.length > 0 && !searchOnly && <p className="sources-label">Sumber</p>}
      <Sources sources={message.sources} open={open} setOpen={setOpen} expandAll={searchOnly} />
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
  const fileInput = useRef(null);
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

  const upload = async (files) => {
    const pdfs = [...files].filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    setUploadError(pdfs.length === files.length ? "" : "Hanya file PDF yang bisa diunggah.");
    for (const file of pdfs) {
      setUploading((n) => n + 1);
      try {
        await api.upload(file);
      } catch (e) {
        setUploadError(`${file.name}: ${e.message}`);
      } finally {
        setUploading((n) => n - 1);
        refresh();
      }
    }
  };

  const remove = async (doc) => {
    if (!confirm(`Hapus "${doc.name}" dari pustaka?`)) return;
    await api.remove(doc.id).catch(() => {});
    refresh();
  };

  const ask = async (text) => {
    const question = text.trim();
    if (!question || asking) return;
    const history = messages
      .filter((m) => !m.error && (m.role === "user" || m.mode === "ai"))
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setAsking(true);
    try {
      const result = await api.ask(question, history);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: result.answer || "", mode: result.mode, notice: result.notice, sources: result.sources },
      ]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", error: e.message }]);
    } finally {
      setAsking(false);
      textRef.current?.focus();
    }
  };

  const ready = documents.filter((d) => d.status === "ready");

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
      {uploadError && <p className="error-text small">{uploadError}</p>}
      <div className="section-label">
        Pustaka dokumen <span>{ready.length}</span>
      </div>
      {documents.length ? (
        <ul className="docs">
          {documents.map((d) => (
            <DocumentItem key={d.id} doc={d} onRemove={remove} />
          ))}
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
                <AssistantMessage key={i} message={m} />
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
            placeholder={ready.length ? "Tulis pertanyaan…" : "Unggah PDF dulu untuk mulai bertanya"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask(input);
              }
            }}
          />
          <button type="submit" className="send" disabled={!input.trim() || asking} aria-label="Kirim">
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
