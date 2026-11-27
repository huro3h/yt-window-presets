const DB_NAME = "export-file";
const STORE = "handles";
const DIR_KEY = "exportDir";
const NAME_KEY = "fileName";
const BASE_NAME = "window-presets";

export const canPickFolder = typeof window.showDirectoryPicker === "function";

function browserSlug() {
  const brands = (navigator.userAgentData?.brands ?? []).map((b) => b.brand);
  if (brands.includes("Brave") || navigator.brave) return "brave";
  if (brands.includes("Microsoft Edge")) return "edge";
  if (brands.includes("Google Chrome")) return "chrome";
  return "";
}

function defaultFileName() {
  const slug = browserSlug();
  return `${BASE_NAME}${slug ? `-${slug}` : ""}.json`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function load(key) {
  try {
    return (await withStore("readonly", (store) => store.get(key))) ?? null;
  } catch {
    return null;
  }
}

const save = (key, value) => withStore("readwrite", (store) => store.put(value, key));

export const loadExportDir = () => load(DIR_KEY);

export async function loadFileName() {
  return (await load(NAME_KEY)) ?? defaultFileName();
}

export async function saveFileName(input) {
  let name = input.trim();
  if (!name || /[/\\:]/.test(name) || name.startsWith(".")) {
    throw new Error("ファイル名に / \\ : は使えません。先頭を . にもできません");
  }
  if (!name.toLowerCase().endsWith(".json")) name += ".json";
  await save(NAME_KEY, name);
  return name;
}

async function pickDir(current) {
  try {
    const dir = await window.showDirectoryPicker({
      id: DB_NAME,
      mode: "readwrite",
      ...(current ? { startIn: current } : {}),
    });
    await save(DIR_KEY, dir);
    return dir;
  } catch (e) {
    if (e?.name === "AbortError") return null;
    throw e;
  }
}

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function exportToFile(text, { chooseDir = false } = {}) {
  const name = await loadFileName();
  if (!canPickFolder) {
    download(text, name);
    return { path: name, downloaded: true };
  }
  const current = await loadExportDir();
  let dir = chooseDir ? null : current;
  if (dir && (await dir.queryPermission({ mode: "readwrite" })) !== "granted") {
    if ((await dir.requestPermission({ mode: "readwrite" })) !== "granted") dir = null;
  }
  if (!dir) {
    dir = await pickDir(current);
    if (!dir) return null;
  }
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(text);
  await writable.close();
  return { path: `${dir.name}/${name}` };
}
