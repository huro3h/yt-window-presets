import {
  DEFAULTS,
  MIN_HEIGHT,
  MIN_WIDTH,
  exportData,
  importData,
  normalizeKeyword,
  normalizePattern,
} from "./rules.js";
import { canPickFolder, exportToFile, loadExportDir, loadFileName, saveFileName } from "./export-file.js";

const $ = (id) => document.getElementById(id);
let presets = [];

async function update(id, patch) {
  presets = presets.map((p) => (p.id === id ? { ...p, ...patch } : p));
  await chrome.storage.sync.set({ presets });
}

function render() {
  const tpl = $("preset");
  $("presets").replaceChildren(
    ...presets.map((p) => {
      const el = tpl.content.firstElementChild.cloneNode(true);
      el.dataset.id = p.id;

      const name = el.querySelector(".name");
      name.value = p.name;
      name.addEventListener("change", () => update(p.id, { name: name.value.trim() || p.name }));

      for (const input of el.querySelectorAll("[data-key]")) {
        const key = input.dataset.key;
        input.value = p[key];
        input.addEventListener("change", () => {
          let v = Math.round(Number(input.value));
          if (!Number.isFinite(v)) v = p[key];
          if (key === "width") v = Math.max(MIN_WIDTH, v);
          if (key === "height") v = Math.max(MIN_HEIGHT, v);
          input.value = v;
          update(p.id, { [key]: v });
        });
      }

      const urls = el.querySelector(".urls");
      urls.value = p.urls.join("\n");
      urls.addEventListener("change", () => {
        const list = [...new Set(urls.value.split("\n").map(normalizePattern).filter(Boolean))];
        urls.value = list.join("\n");
        update(p.id, { urls: list });
      });

      const keywords = el.querySelector(".keywords");
      keywords.value = (p.keywords || []).join("\n");
      keywords.addEventListener("change", () => {
        const list = [...new Set(keywords.value.split("\n").map(normalizeKeyword).filter(Boolean))];
        keywords.value = list.join("\n");
        update(p.id, { keywords: list });
      });

      const isDefault = el.querySelector(".is-default");
      isDefault.checked = !!p.isDefault;
      isDefault.addEventListener("change", async () => {
        const on = isDefault.checked;
        presets = presets.map((x) => ({ ...x, isDefault: on && x.id === p.id }));
        await chrome.storage.sync.set({ presets });
        render();
      });

      el.querySelector(".delete").addEventListener("click", async () => {
        presets = presets.filter((x) => x.id !== p.id);
        await chrome.storage.sync.set({ presets });
        render();
      });

      enableDrag(el);
      return el;
    }),
  );
  $("empty").hidden = presets.length > 0;
  $("export").disabled = $("changeExportTarget").disabled = presets.length === 0;
}

function enableDrag(card) {
  const grip = card.querySelector(".grip");
  grip.addEventListener("pointerdown", () => (card.draggable = true));
  grip.addEventListener("pointerup", () => (card.draggable = false));
  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", card.dataset.id);
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", async () => {
    card.draggable = false;
    card.classList.remove("dragging");
    const order = [...$("presets").children].map((c) => c.dataset.id);
    if (order.join() === presets.map((p) => p.id).join()) return;
    const byId = new Map(presets.map((p) => [p.id, p]));
    presets = order.map((id) => byId.get(id)).filter(Boolean);
    await chrome.storage.sync.set({ presets });
  });
}

$("presets").addEventListener("dragover", (e) => {
  const dragging = $("presets").querySelector(".dragging");
  if (!dragging) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const after = [...$("presets").children].find((c) => {
    if (c === dragging) return false;
    const r = c.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2;
  });
  if (after) {
    if (dragging.nextElementSibling !== after) $("presets").insertBefore(dragging, after);
  } else if ($("presets").lastElementChild !== dragging) {
    $("presets").append(dragging);
  }
});
$("presets").addEventListener("drop", (e) => e.preventDefault());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes.presets) return;
  const next = changes.presets.newValue || [];
  const shape = (list) =>
    list.map((p) => `${p.id}:${p.urls.length}:${(p.keywords || []).length}:${!!p.isDefault}`).join(",");
  const changed = shape(next) !== shape(presets);
  presets = next;
  if (changed) render();
});

function showMessage(text, isError = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", isError);
}

async function showExportTarget() {
  $("exportFileName").value = await loadFileName();
  if (!canPickFolder) {
    $("exportDir").textContent = "ダウンロードフォルダ(このブラウザはフォルダを選べません)";
    $("changeExportTarget").hidden = true;
    return;
  }
  const dir = await loadExportDir();
  $("exportDir").textContent = dir ? dir.name : "(フォルダは初回に選びます)";
}

async function exportSettings({ chooseDir = false } = {}) {
  try {
    $("exportFileName").value = await saveFileName($("exportFileName").value);
  } catch (e) {
    showMessage(e.message, true);
    return;
  }
  const settings = await chrome.storage.sync.get(DEFAULTS);
  let result;
  try {
    result = await exportToFile(`${JSON.stringify(exportData(settings), null, 2)}\n`, { chooseDir });
  } catch {
    showMessage("書き出せませんでした。「フォルダを変更」から書き出し先を選び直してください", true);
    return;
  }
  if (!result) {
    showMessage("エクスポートをやめました");
    return;
  }
  await showExportTarget();
  showMessage(`${result.path} に ${settings.presets.length} 個の設定を書き出しました`);
}

$("exportFileName").addEventListener("change", async () => {
  try {
    $("exportFileName").value = await saveFileName($("exportFileName").value);
    showMessage("");
  } catch (e) {
    showMessage(e.message, true);
    $("exportFileName").value = await loadFileName();
  }
});
$("exportFileName").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) $("exportFileName").blur();
});
$("export").addEventListener("click", () => exportSettings());
$("changeExportTarget").addEventListener("click", () => exportSettings({ chooseDir: true }));

$("import").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async () => {
  const file = $("importFile").files[0];
  $("importFile").value = "";
  if (!file) return;
  try {
    const next = importData(JSON.parse(await file.text()));
    presets = next.presets;
    await chrome.storage.sync.set(next);
    render();
    showMessage(`${next.presets.length} 個の設定を読み込みました(今までの設定は置き換えました)`);
  } catch (e) {
    showMessage(`読み込めませんでした: ${e instanceof SyntaxError ? "JSON として読めません" : e.message}`, true);
  }
});

(async () => {
  ({ presets } = await chrome.storage.sync.get(DEFAULTS));
  render();
  showExportTarget();
})();
