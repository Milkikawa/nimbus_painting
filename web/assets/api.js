export async function api(url, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      text ||
      `请求失败：${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return data ?? {};
}

export const asList = (value) => (Array.isArray(value) ? value : []);
export const text = (value) =>
  value === null || value === undefined || value === "" ? "—" : String(value);
export const fmtDate = (value) =>
  value ? new Date(value).toLocaleString("zh-CN") : "—";
export const fmtBytes = (value) =>
  value === null || value === undefined
    ? "暂未统计"
    : `${(value / 1024 / 1024).toFixed(2)} MB`;
export const percent = (value) => `${Number(value || 0).toFixed(1)}%`;
export function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[
        char
      ])
  );
}

export function safeURL(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("/images/")) return raw;
  try {
    const parsed = new URL(raw, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? raw
      : "";
  } catch {
    return "";
  }
}
