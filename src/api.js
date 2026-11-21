async function request(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
  return data;
}

const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  status: () => request("/api/status"),
  documents: () => request("/api/documents").then((d) => d.documents),
  upload: (file, replace) =>
    request(`/api/documents${replace ? `?replace=${encodeURIComponent(replace)}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf", "X-Filename": encodeURIComponent(file.name) },
      body: file,
    }),
  remove: (id) => request(`/api/documents/${id}`, { method: "DELETE" }),
  ask: (question, history, docIds) => request("/api/chat", json("POST", { question, history, docIds })),
  saveKey: (key) => request("/api/settings/key", json("PUT", { key })),
  removeKey: () => request("/api/settings/key", { method: "DELETE" }),
};

export const fileUrl = (source) =>
  `/api/documents/${source.docId}/file#page=${source.page}`;

export const displayName = (name) =>
  name.replace(/\.pdf$/i, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
