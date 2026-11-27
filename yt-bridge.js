document.addEventListener("window-presets:report", (e) => {
  try {
    chrome.runtime.sendMessage({ type: "yt-report", report: JSON.parse(e.detail) });
  } catch {}
});
