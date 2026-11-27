import { DEFAULTS, migratePriority, resolve } from "./rules.js";

const APPLIED_KEY = "applied";

async function getApplied() {
  const { [APPLIED_KEY]: map = {} } = await chrome.storage.session.get(APPLIED_KEY);
  return map;
}

async function setApplied(windowId, presetId) {
  const map = await getApplied();
  if (presetId) map[windowId] = presetId;
  else delete map[windowId];
  await chrome.storage.session.set({ [APPLIED_KEY]: map });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function applyBounds(windowId, preset) {
  let win = await chrome.windows.get(windowId);
  if (win.state !== "normal") {
    const wasFullscreen = win.state === "fullscreen";
    await chrome.windows.update(windowId, { state: "normal" });
    for (let i = 0; i < 20; i++) {
      win = await chrome.windows.get(windowId);
      if (win.state === "normal") break;
      await sleep(100);
    }
    if (wasFullscreen) await sleep(400);
  }
  await chrome.windows.update(windowId, {
    left: preset.left,
    top: preset.top,
    width: preset.width,
    height: preset.height,
  });
}

let queue = Promise.resolve();
function enqueue(fn) {
  queue = queue.then(fn).catch((e) => console.warn("[window-presets]", e));
  return queue;
}

const REPORTS_KEY = "ytReports";

async function getReports() {
  const { [REPORTS_KEY]: map = {} } = await chrome.storage.session.get(REPORTS_KEY);
  return map;
}

async function setReport(tabId, report) {
  const map = await getReports();
  if (report) map[tabId] = report;
  else delete map[tabId];
  await chrome.storage.session.set({ [REPORTS_KEY]: map });
}

async function evaluate(tab) {
  if (!tab || !tab.active || tab.windowId === chrome.windows.WINDOW_ID_NONE) return;
  const { enabled, presets } = await chrome.storage.sync.get(DEFAULTS);
  if (!enabled) return void (await setApplied(tab.windowId, null));
  const reports = await getReports();
  const { preset, pending } = resolve(presets, tab.url, reports[tab.id]);
  if (pending) return;
  const applied = await getApplied();

  if (!preset) {
    if (applied[tab.windowId]) await setApplied(tab.windowId, null);
    return;
  }
  if (applied[tab.windowId] === preset.id) return;

  const win = await chrome.windows.get(tab.windowId);
  if (win.type !== "normal" && win.type !== "popup") return;
  await setApplied(tab.windowId, preset.id);
  try {
    await applyBounds(tab.windowId, preset);
  } catch (e) {
    console.warn("[window-presets] apply failed", e);
    await setApplied(tab.windowId, null);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) enqueue(() => evaluate(tab));
});

chrome.tabs.onRemoved.addListener((tabId) => enqueue(() => setReport(tabId, null)));

chrome.tabs.onActivated.addListener(({ tabId }) => {
  enqueue(async () => evaluate(await chrome.tabs.get(tabId)));
});

chrome.windows.onRemoved.addListener((windowId) => enqueue(() => setApplied(windowId, null)));

async function migrate() {
  const { presets } = await chrome.storage.sync.get(DEFAULTS);
  const next = migratePriority(presets);
  if (next) await chrome.storage.sync.set({ presets: next });
}
chrome.runtime.onInstalled.addListener(() => enqueue(migrate));
chrome.runtime.onStartup.addListener(() => enqueue(migrate));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "yt-report" && sender.tab?.id != null) {
    const tabId = sender.tab.id;
    enqueue(async () => {
      await setReport(tabId, msg.report);
      await evaluate(await chrome.tabs.get(tabId));
    });
    return;
  }
  if (msg?.type !== "apply") return;
  enqueue(async () => {
    const { presets } = await chrome.storage.sync.get(DEFAULTS);
    const preset = presets.find((p) => p.id === msg.presetId);
    if (!preset) return sendResponse({ ok: false });
    try {
      await setApplied(msg.windowId, preset.id);
      await applyBounds(msg.windowId, preset);
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  });
  return true;
});
