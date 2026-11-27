(() => {
  const EVENT = "yt-window-presets:report";
  let lastKey = "";
  let prevId = null;
  let navAt = 0;
  let timer = null;

  function videoData() {
    try {
      return document.querySelector("#movie_player")?.getVideoData?.() || null;
    } catch {
      return null;
    }
  }

  function expectedId() {
    const u = new URL(location.href);
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/live\/([^/]+)/);
    return m ? m[1] : undefined;
  }

  function report() {
    const vd = videoData();
    if (!vd?.video_id) return;
    const want = expectedId();
    if (want !== undefined && want !== vd.video_id) return;
    if (want === undefined && vd.video_id === prevId && Date.now() - navAt < 3000) return;
    const data = { url: location.href, videoId: vd.video_id, isLive: !!vd.isLive, title: vd.title || "" };
    const key = JSON.stringify(data);
    if (key === lastKey) return;
    lastKey = key;
    document.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
  }

  function burst() {
    clearInterval(timer);
    let n = 0;
    report();
    timer = setInterval(() => {
      report();
      if (++n >= 20) clearInterval(timer);
    }, 500);
  }

  document.addEventListener("yt-navigate-start", () => {
    prevId = videoData()?.video_id || null;
    navAt = Date.now();
    lastKey = "";
  });
  document.addEventListener("yt-navigate-finish", burst);
  document.addEventListener("yt-page-data-updated", burst);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", burst);
  } else {
    burst();
  }
})();
