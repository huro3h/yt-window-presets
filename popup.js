import {
  DEFAULTS,
  boundsOf,
  formatBounds,
  newId,
  normalizePattern,
  resolve,
  suggestPattern,
} from "./rules.js";

const $ = (id) => document.getElementById(id);

let settings = { ...DEFAULTS };
let win;
let tab;
let report;

async function save(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.sync.set(patch);
  render();
}

function render() {
  $("enabled").checked = settings.enabled;

  const r = tab ? resolve(settings.presets, tab.url, report) : { preset: null };
  $("match").textContent = r.preset
    ? `${{ title: "タイトル", url: "URL", default: "デフォルト" }[r.by]}「${r.preset.name}」にマッチ`
    : r.notLive
      ? "YouTube の配信中のページではないので対象外です"
      : r.pending
        ? "配信かどうかを確認中です"
        : "どの設定にも当たっていません";

  const select = $("target");
  const prev = select.value;
  select.replaceChildren(
    ...settings.presets.map((p) => new Option(p.name, p.id)),
  );
  if (settings.presets.some((p) => p.id === prev)) select.value = prev;
  select.disabled = $("link").disabled = settings.presets.length === 0;

  const list = $("presets");
  list.replaceChildren(
    ...settings.presets.map((p) => {
      const li = document.createElement("li");
      const info = document.createElement("div");
      info.className = "info";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = p.name;
      if (p.isDefault) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "デフォルト";
        name.append(badge);
      }
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = formatBounds(p);
      const count = document.createElement("div");
      count.className = "meta";
      count.textContent = `URL ${p.urls.length}件・キーワード ${(p.keywords || []).length}件`;
      info.append(name, meta, count);

      const apply = document.createElement("button");
      apply.textContent = "適用";
      apply.title = "今のウィンドウにこの位置とサイズを当てる";
      apply.addEventListener("click", async () => {
        await chrome.runtime.sendMessage({ type: "apply", windowId: win.id, presetId: p.id });
        window.close();
      });

      const overwrite = document.createElement("button");
      overwrite.textContent = "上書き";
      overwrite.title = "今のウィンドウの位置とサイズで上書きする";
      overwrite.addEventListener("click", () =>
        save({
          presets: settings.presets.map((x) => (x.id === p.id ? { ...x, ...boundsOf(win) } : x)),
        }),
      );

      li.append(info, apply, overwrite);
      return li;
    }),
  );
  $("empty").hidden = settings.presets.length > 0;
  $("current").textContent = formatBounds(boundsOf(win));
}

async function init() {
  settings = await chrome.storage.sync.get(DEFAULTS);
  win = await chrome.windows.getCurrent();
  [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (tab) ({ ytReports: { [tab.id]: report } = {} } = await chrome.storage.session.get("ytReports"));
  $("pattern").value = tab ? suggestPattern(tab.url) : "";

  $("enabled").addEventListener("change", (e) => save({ enabled: e.target.checked }));

  $("add").addEventListener("click", async () => {
    win = await chrome.windows.getCurrent();
    const name = $("name").value.trim() || `設定 ${settings.presets.length + 1}`;
    const preset = { id: newId(), name, ...boundsOf(win), urls: [], keywords: [] };
    $("name").value = "";
    await save({ presets: [...settings.presets, preset] });
    $("target").value = preset.id;
  });

  $("link").addEventListener("click", () => {
    const pattern = normalizePattern($("pattern").value);
    const id = $("target").value;
    if (!pattern || !id) return;
    save({
      presets: settings.presets.map((p) =>
        p.id === id && !p.urls.includes(pattern) ? { ...p, urls: [...p.urls, pattern] } : p,
      ),
    });
  });

  $("version").textContent = `v${chrome.runtime.getManifest().version}`;
  $("options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  render();
}

init();
