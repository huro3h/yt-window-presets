export const DEFAULTS = {
  enabled: true,
  notify: true,
  presets: [],
};

export const MIN_WIDTH = 200;
export const MIN_HEIGHT = 150;

export function newId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function boundsOf(win) {
  return {
    left: Math.round(win.left),
    top: Math.round(win.top),
    width: Math.round(win.width),
    height: Math.round(win.height),
  };
}

export function formatBounds(p) {
  return `${p.width}×${p.height}・位置 ${p.left}, ${p.top}`;
}

export function normalizePattern(input) {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s || s.startsWith("#")) return null;
  s = s.replace(/\*{2,}/g, "*");
  if (s === "*") return null;
  return s;
}

export function suggestPattern(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return "";
  }
  if (!/^https?:$/.test(u.protocol)) return "";
  const base = `${u.origin}${u.pathname}`;
  if (!u.search) return base;
  const queryIsBody = u.pathname === "/" || /\/(watch|search|results)$/.test(u.pathname);
  return queryIsBody ? `${base}${u.search}` : base;
}

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

export function patternToRegExp(pattern) {
  const p = normalizePattern(pattern);
  if (!p) return null;
  let body = p;
  let scheme = "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(body)) {
    scheme = "https?://";
  }
  const re = body
    .split("*")
    .map(escapeRe)
    .join(".*");
  const tail = /[/?#&=*]$/.test(p) ? ".*" : "(?:[/?#].*)?";
  return new RegExp(`^${scheme}${re}${tail}$`, "i");
}

export function urlMatches(url, pattern) {
  const re = patternToRegExp(pattern);
  return !!re && typeof url === "string" && re.test(url);
}

export function migratePriority(presets) {
  if (!(presets || []).some((p) => "priority" in p)) return null;
  const num = (p) => (Number.isFinite(Number(p.priority)) ? Number(p.priority) : 0);
  return presets
    .map((p, i) => ({ p, i }))
    .sort((a, b) => num(b.p) - num(a.p) || a.i - b.i)
    .map(({ p }) => {
      const { priority, ...rest } = p;
      return rest;
    });
}

export function urlCandidates(presets, url) {
  if (typeof url !== "string" || !/^https?:/i.test(url)) return [];
  const out = [];
  (presets || []).forEach((preset, rank) => {
    if ((preset.urls || []).some((pattern) => urlMatches(url, pattern))) {
      out.push({ preset, by: "url", rank });
    }
  });
  return out;
}

export function isYouTubeHost(url) {
  try {
    return /^(www\.)?youtube\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function isYouTubeVideoPage(url) {
  if (!isYouTubeHost(url)) return false;
  const { pathname } = new URL(url);
  return (
    pathname === "/watch" ||
    /^\/live\/[^/]+$/.test(pathname) ||
    /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/live\/?$/.test(pathname)
  );
}

export function reportMatches(report, url) {
  if (!report || typeof url !== "string") return false;
  const strip = (s) => String(s).split("#")[0];
  if (strip(report.url) !== strip(url)) return false;
  const u = new URL(url);
  if (u.pathname === "/watch") return report.videoId === u.searchParams.get("v");
  return true;
}

export function foldText(s) {
  return String(s).normalize("NFKC").toLowerCase();
}

export function normalizeKeyword(input) {
  if (typeof input !== "string") return null;
  const s = input.trim();
  return s || null;
}

export function titleCandidates(presets, title) {
  const t = foldText(title || "").trim();
  if (!t) return [];
  const out = [];
  (presets || []).forEach((preset, rank) => {
    if ((preset.keywords || []).some((k) => foldText(k) && t.includes(foldText(k)))) {
      out.push({ preset, by: "title", rank });
    }
  });
  return out;
}

export function portraitCandidates(presets, orientation) {
  if (orientation !== "portrait") return [];
  const out = [];
  (presets || []).forEach((preset, rank) => {
    if (preset.portrait) out.push({ preset, by: "portrait", rank });
  });
  return out;
}

export function pick(candidates) {
  let best = null;
  for (const c of candidates) {
    if (!best || c.rank < best.rank || (c.rank === best.rank && c.by === "url")) best = c;
  }
  return best;
}

const NONE = { preset: null, by: null, pending: false, notLive: false };

export function resolve(presets, url, report) {
  if (isYouTubeHost(url)) {
    if (!isYouTubeVideoPage(url)) return { ...NONE, notLive: true };
    if (!reportMatches(report, url)) return { ...NONE, pending: true };
    if (!report.isLive) return { ...NONE, notLive: true };
    const known = [...urlCandidates(presets, url), ...titleCandidates(presets, report.title)];
    if (report.orientation == null) {
      const best = pick(known);
      const waiting = (presets || []).some((p, rank) => p.portrait && (!best || rank < best.rank));
      if (waiting) return { ...NONE, pending: true };
    }
    const matched = pickResult([...known, ...portraitCandidates(presets, report.orientation)]);
    if (matched.preset) return matched;
    const fallback = (presets || []).find((p) => p.isDefault);
    return fallback ? { ...NONE, preset: fallback, by: "default" } : NONE;
  }
  return pickResult(urlCandidates(presets, url));
}

function pickResult(candidates) {
  const c = pick(candidates);
  return c ? { ...NONE, preset: c.preset, by: c.by } : NONE;
}

const FORMAT = "yt-window-presets";

export function exportData({ enabled, notify, presets }) {
  return {
    format: FORMAT,
    version: 1,
    enabled: enabled !== false,
    notify: notify !== false,
    presets: (presets || []).map((p) => ({
      id: p.id,
      name: p.name,
      left: p.left,
      top: p.top,
      width: p.width,
      height: p.height,
      urls: p.urls || [],
      keywords: p.keywords || [],
      isDefault: !!p.isDefault,
      portrait: !!p.portrait,
    })),
  };
}

export function importData(data) {
  if (data?.format !== FORMAT || !Array.isArray(data.presets)) {
    throw new Error("YouTube Window Presets で書き出したファイルではありません");
  }
  const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
  const ids = new Set();
  let hasDefault = false;
  const presets = [];
  for (const p of data.presets) {
    const b = { left: int(p?.left), top: int(p?.top), width: int(p?.width), height: int(p?.height) };
    if (typeof p?.name !== "string" || Object.values(b).some((v) => v === null)) {
      throw new Error("位置とサイズが数値でない設定があります");
    }
    let id = typeof p.id === "string" && p.id ? p.id : newId();
    if (ids.has(id)) id = newId();
    ids.add(id);
    const isDefault = p.isDefault === true && !hasDefault;
    hasDefault ||= isDefault;
    presets.push({
      id,
      name: p.name.trim() || "設定",
      left: b.left,
      top: b.top,
      width: Math.max(MIN_WIDTH, b.width),
      height: Math.max(MIN_HEIGHT, b.height),
      urls: [...new Set((Array.isArray(p.urls) ? p.urls : []).map(normalizePattern).filter(Boolean))],
      keywords: [...new Set((Array.isArray(p.keywords) ? p.keywords : []).map(normalizeKeyword).filter(Boolean))],
      ...(isDefault ? { isDefault: true } : {}),
      ...(p.portrait === true ? { portrait: true } : {}),
    });
  }
  return { enabled: data.enabled !== false, notify: data.notify !== false, presets };
}
