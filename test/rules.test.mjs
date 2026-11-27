import test from "node:test";
import assert from "node:assert/strict";
import {
  exportData,
  importData,
  isYouTubeVideoPage,
  normalizePattern,
  migratePriority,
  pick,
  reportMatches,
  resolve,
  suggestPattern,
  urlMatches,
} from "../rules.js";

const LIVE = "https://www.youtube.com/@example/live";

test("urlMatches: 前方一致は区切りか末尾まで", () => {
  assert.ok(urlMatches(LIVE, LIVE));
  assert.ok(urlMatches(`${LIVE}?si=abc`, LIVE));
  assert.ok(urlMatches(`${LIVE}/`, LIVE));
  assert.ok(urlMatches(`${LIVE}#x`, LIVE));
  assert.ok(!urlMatches(`${LIVE}stream`, LIVE));
  assert.ok(!urlMatches("https://www.youtube.com/@example2/live", "https://www.youtube.com/@example"));
});

test("urlMatches: 区切りで終わるパターンは続きを何でも許す", () => {
  assert.ok(urlMatches("https://www.youtube.com/@example/videos", "https://www.youtube.com/@example/"));
  assert.ok(urlMatches("https://www.youtube.com/watch?v=abc&t=1", "https://www.youtube.com/watch?v=abc&"));
});

test("urlMatches: ワイルドカードとスキーム省略", () => {
  assert.ok(urlMatches(LIVE, "https://www.youtube.com/@*/live"));
  assert.ok(!urlMatches("https://www.youtube.com/@example/videos", "https://www.youtube.com/@*/live"));
  assert.ok(urlMatches(LIVE, "www.youtube.com/@example/live"));
  assert.ok(urlMatches("http://www.youtube.com/@example/live", "www.youtube.com/@example/live"));
  assert.ok(!urlMatches(LIVE, "https://youtube.com/@example/live"));
  assert.ok(!urlMatches("https://wwwXyoutube.com/", "https://www.youtube.com/"));
  assert.ok(urlMatches("https://www.youtube.com/watch?v=abc", "https://www.youtube.com/watch?v=abc"));
});

test("normalizePattern: 空・コメント・全一致は捨てる", () => {
  assert.equal(normalizePattern("  "), null);
  assert.equal(normalizePattern("# memo"), null);
  assert.equal(normalizePattern("*"), null);
  assert.equal(normalizePattern("**"), null);
  assert.equal(normalizePattern(` ${LIVE} `), LIVE);
});

const urlPick = (presets, url) => resolve(presets, url, null).preset;

test("URL: 並び順が上の設定を使う、http(s) 以外は対象外", () => {
  const wide = { id: "a", urls: ["https://example.com/"] };
  const narrow = { id: "b", urls: ["https://example.com/live"] };
  assert.equal(urlPick([narrow, wide], "https://example.com/live/x").id, "b");
  assert.equal(urlPick([wide, narrow], "https://example.com/live/x").id, "a");
  assert.equal(urlPick([narrow, wide], "https://example.com/feed").id, "a");
  assert.equal(urlPick([narrow], "https://example.org/"), null);
  assert.equal(urlPick([{ id: "c", urls: ["chrome://*"] }], "chrome://newtab/"), null);
  assert.equal(urlPick([], undefined), null);
});

test("suggestPattern: 付け足しのクエリは落とし、本体のクエリは残す", () => {
  assert.equal(suggestPattern(`${LIVE}?si=xyz#t`), LIVE);
  assert.equal(suggestPattern("https://www.youtube.com/watch?v=abc#t"), "https://www.youtube.com/watch?v=abc");
  assert.equal(suggestPattern("chrome://extensions/"), "");
  assert.equal(suggestPattern("not a url"), "");
});

test("isYouTubeVideoPage: 配信があり得るページだけ", () => {
  assert.ok(isYouTubeVideoPage("https://www.youtube.com/watch?v=abc"));
  assert.ok(isYouTubeVideoPage("https://www.youtube.com/live/abc"));
  assert.ok(isYouTubeVideoPage(LIVE));
  assert.ok(isYouTubeVideoPage("https://www.youtube.com/channel/UCxxxx/live"));
  assert.ok(!isYouTubeVideoPage("https://www.youtube.com/shorts/abc"));
  assert.ok(!isYouTubeVideoPage("https://www.youtube.com/"));
  assert.ok(!isYouTubeVideoPage("https://www.youtube.com/results?search_query=x"));
  assert.ok(!isYouTubeVideoPage("https://www.youtube.com/@example/videos"));
  assert.ok(!isYouTubeVideoPage("https://notyoutube.com/watch?v=abc"));
});

const VERT = { id: "v", urls: [], keywords: ["#縦型配信"] };
const BYURL = { id: "u", urls: [LIVE], keywords: [] };
const WATCH = "https://www.youtube.com/watch?v=abc";
const HORIZ = { id: "h", urls: ["www.youtube.com/watch", "www.youtube.com/@*/live"], keywords: [] };
const live = (url, title, videoId = "abc") => ({ url, videoId, isLive: true, title });

test("reportMatches: 今の URL の報告か", () => {
  assert.ok(reportMatches(live(WATCH, "x"), WATCH));
  assert.ok(reportMatches(live(WATCH, "x"), `${WATCH}#t`));
  assert.ok(!reportMatches(live(WATCH, "x", "zzz"), WATCH));
  assert.ok(!reportMatches(live("https://www.youtube.com/watch?v=old", "x", "old"), WATCH));
  assert.ok(reportMatches(live(LIVE, "x", "any"), LIVE));
  assert.ok(!reportMatches(null, WATCH));
});

test("pick: 並び順が上の設定 → 同じ設定なら URL と表示", () => {
  assert.equal(pick([{ preset: { id: "a" }, by: "url", rank: 1 }, { preset: { id: "b" }, by: "title", rank: 0 }]).preset.id, "b");
  assert.equal(pick([{ preset: { id: "a" }, by: "title", rank: 0 }, { preset: { id: "a" }, by: "url", rank: 0 }]).by, "url");
  assert.equal(pick([]), null);
});

test("resolve: 縦型配信は設定1、残りの配信は設定2", () => {
  assert.equal(resolve([VERT, HORIZ], WATCH, live(WATCH, "雑談 #縦型配信")).preset.id, "v");
  assert.equal(resolve([VERT, HORIZ], WATCH, live(WATCH, "雑談")).preset.id, "h");
  assert.equal(resolve([VERT, HORIZ], LIVE, live(LIVE, "雑談 #縦型配信")).preset.id, "v");
  assert.equal(resolve([VERT, HORIZ], LIVE, live(LIVE, "雑談")).preset.id, "h");
  assert.equal(resolve([VERT], WATCH, live(WATCH, "雑談 ＃縦型配信")).by, "title");
  assert.equal(resolve([{ ...VERT, keywords: ["vertical"] }], WATCH, live(WATCH, "VERTICAL")).by, "title");
  assert.equal(resolve([HORIZ, VERT], WATCH, live(WATCH, "雑談 #縦型配信")).preset.id, "h");
  assert.equal(resolve([BYURL, HORIZ], LIVE, live(LIVE, "雑談")).preset.id, "u");
});

test("resolve: YouTube は配信中のページだけ。通常の動画・ショート・アーカイブは対象外", () => {
  const video = { url: WATCH, videoId: "abc", isLive: false, title: "雑談 #縦型配信" };
  let r = resolve([VERT, HORIZ], WATCH, video);
  assert.equal(r.preset, null);
  assert.equal(r.notLive, true);
  r = resolve([{ id: "s", urls: ["www.youtube.com/"] }], "https://www.youtube.com/shorts/abc", null);
  assert.equal(r.preset, null);
  assert.equal(r.notLive, true);
  assert.equal(resolve([{ id: "t", urls: ["www.youtube.com/"] }], "https://www.youtube.com/", null).preset, null);
});

test("resolve: YouTube の配信ページでは今のページの報告が届くまで pending", () => {
  assert.equal(resolve([VERT, HORIZ], WATCH, null).pending, true);
  assert.equal(resolve([VERT, HORIZ], WATCH, live("https://www.youtube.com/watch?v=old", "#縦型配信", "old")).pending, true);
  assert.equal(resolve([VERT, HORIZ], WATCH, null).preset, null);
  assert.equal(resolve([VERT], "https://example.com/", null).pending, false);
  assert.equal(resolve([{ id: "o", urls: [] }], WATCH, live(WATCH, "x")).preset, null);
});

test("migratePriority: 数値の優先度の順に並べて消す (一度だけ)", () => {
  assert.equal(migratePriority([{ id: "a" }, { id: "b" }]), null);
  const out = migratePriority([
    { id: "a", priority: 0 },
    { id: "b", priority: 10 },
    { id: "c" },
    { id: "d", priority: 10 },
  ]);
  assert.deepEqual(out.map((p) => p.id), ["b", "d", "a", "c"]);
  assert.ok(out.every((p) => !("priority" in p)));
});

test("resolve: デフォルトはどの設定にも当たらない YouTube の配信だけ", () => {
  const DEF = { id: "d", urls: [], keywords: [], isDefault: true };
  assert.equal(resolve([VERT, DEF], WATCH, live(WATCH, "雑談 #縦型配信")).preset.id, "v");
  const r = resolve([VERT, DEF], WATCH, live(WATCH, "雑談"));
  assert.equal(r.preset.id, "d");
  assert.equal(r.by, "default");
  assert.equal(resolve([DEF, VERT], WATCH, live(WATCH, "雑談 #縦型配信")).preset.id, "v");
  assert.equal(resolve([DEF], WATCH, { url: WATCH, videoId: "abc", isLive: false, title: "x" }).preset, null);
  assert.equal(resolve([DEF], "https://www.youtube.com/shorts/abc", null).preset, null);
  assert.equal(resolve([DEF], WATCH, null).pending, true);
  assert.equal(resolve([DEF], "https://example.com/", null).preset, null);
  assert.equal(resolve([VERT], WATCH, live(WATCH, "雑談")).preset, null);
});

test("exportData / importData: 書き出したものを読み込むと元に戻る", () => {
  const presets = [
    { id: "v", name: "縦型", left: 1180, top: 25, width: 560, height: 1050, urls: [LIVE], keywords: ["#縦型配信"] },
    { id: "h", name: "横型", left: 0, top: 25, width: 1440, height: 860, urls: [], keywords: [], isDefault: true },
  ];
  const data = JSON.parse(JSON.stringify(exportData({ enabled: false, notify: false, presets })));
  assert.equal(data.format, "yt-window-presets");
  const back = importData(data);
  assert.equal(back.enabled, false);
  assert.equal(back.notify, false);
  assert.deepEqual(back.presets.map((p) => p.id), ["v", "h"]);
  assert.deepEqual(back.presets[0].urls, [LIVE]);
  assert.equal(back.presets[1].isDefault, true);
  assert.ok(!("isDefault" in back.presets[0]));
});

test("importData: 形式が違う・数値でないものは読み込まない、値は整える", () => {
  assert.throws(() => importData({ sets: [] }), /Window Presets/);
  assert.throws(() => importData({ format: "yt-window-presets", presets: [{ name: "x", left: "a", top: 0, width: 1, height: 1 }] }), /数値/);
  const r = importData({
    format: "yt-window-presets",
    presets: [
      { id: "a", name: " a ", left: 1.4, top: "2", width: 10, height: 10, urls: [" x.com/ ", "*", "x.com/"], keywords: ["#k", "#k", " "], isDefault: true },
      { id: "a", name: "", left: 0, top: 0, width: 800, height: 600, isDefault: true },
    ],
  });
  assert.equal(r.enabled, true);
  assert.equal(r.notify, true);
  const [a, b] = r.presets;
  assert.equal(a.name, "a");
  assert.deepEqual([a.left, a.top, a.width, a.height], [1, 2, 200, 150]);
  assert.deepEqual(a.urls, ["x.com/"]);
  assert.deepEqual(a.keywords, ["#k"]);
  assert.equal(a.isDefault, true);
  assert.notEqual(b.id, "a");
  assert.equal(b.name, "設定");
  assert.ok(!("isDefault" in b));
});
