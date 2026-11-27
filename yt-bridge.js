document.addEventListener("yt-window-presets:report", (e) => {
  try {
    chrome.runtime.sendMessage({ type: "yt-report", report: JSON.parse(e.detail) });
  } catch {}
});

(() => {
  const TOAST_ID = "wp-applied-toast";
  let hideTimer = null;
  let removeTimer = null;

  function toastStyle() {
    if (document.getElementById(`${TOAST_ID}-style`)) return;
    const style = document.createElement("style");
    style.id = `${TOAST_ID}-style`;
    style.textContent = `
#${TOAST_ID}{position:absolute;right:12px;top:52px;z-index:1000;max-width:min(300px,50%);
  padding:7px 10px;border-radius:6px;background:rgba(15,15,15,.75);color:#fff;
  font:12px/1.4 Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;
  text-shadow:0 1px 1px rgba(0,0,0,.85),0 0 1px rgba(0,0,0,.85);box-shadow:0 2px 8px rgba(0,0,0,.2);
  pointer-events:none;opacity:1;transition:opacity .3s}
#${TOAST_ID}.wp-fixed{position:fixed;right:24px;top:72px}
#${TOAST_ID}.wp-hide{opacity:0}
#${TOAST_ID} .wp-toast-app{color:#ccc;font-size:10px;font-weight:500}
#${TOAST_ID} .wp-toast-msg{font-weight:500;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#${TOAST_ID} .wp-toast-name{color:#ff8fab}`;
    (document.head || document.documentElement).appendChild(style);
  }

  function showToast(name) {
    toastStyle();
    clearTimeout(hideTimer);
    clearTimeout(removeTimer);
    document.getElementById(TOAST_ID)?.remove();
    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    const label = document.createElement("span");
    label.className = "wp-toast-name";
    label.textContent = name || "(名前なし)";
    const app = document.createElement("div");
    app.className = "wp-toast-app";
    app.textContent = "YouTube Window Presets";
    const msg = document.createElement("div");
    msg.className = "wp-toast-msg";
    msg.append("設定「", label, "」を適用しました");
    toast.append(app, msg);
    const player = document.getElementById("movie_player");
    if (player) player.appendChild(toast);
    else {
      toast.classList.add("wp-fixed");
      document.body.appendChild(toast);
    }
    hideTimer = setTimeout(() => {
      toast.classList.add("wp-hide");
      removeTimer = setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "applied-toast") showToast(msg.name);
  });
})();
