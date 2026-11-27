---
name: window-presets
description: Window Presets(登録した URL を開いたらウィンドウの位置とサイズを自動で合わせる Chrome 拡張)を改修・デバッグするときに使う。適用のタイミングの設計、URL パターンの仕様、YouTube の配信判定(プレイヤーから読む)、E2E で踏んだ落とし穴を記録している。
---

# Window Presets 開発メモ

## コードにコメントを書かない

ユーザーの指定(2026-11-27)で、JS・CSS・HTML・テストのコメントはすべて削除した。設計の理由やハマりどころは
コードに書かず、このスキルに書く。改修でもコメントを足さない。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `background.js` | service worker。タブの遷移・切り替えを見て、当たったらウィンドウの位置とサイズを変える |
| `yt-main.js` | YouTube のページの MAIN world。プレイヤーから「配信中か・タイトル」を読み、CustomEvent で `yt-bridge.js` へ |
| `yt-bridge.js` | ISOLATED world。`yt-main.js` の報告を `chrome.runtime.sendMessage` で background へ渡す |
| `rules.js` | 設定のデフォルト、URL パターンの判定、表示用の整形。chrome API に依存しない(Node から単体テストする) |
| `popup.*` | 今のウィンドウの登録、今のタブの URL の紐づけ、適用・上書き。見出しは小さいグレーの名前 + バージョン、右上に ON/OFF と設定画面への歯車(Bookmark Set Opener に合わせた。ユーザー指定) |
| `options.*` | 名前・位置とサイズ・URL・キーワードの編集と削除、カードのドラッグでの並べ替え(= 優先度)。説明文は置かない(ユーザー指定)。削除はゴミ箱アイコンの枠付きボタンで、ホバーで赤く塗る(Bookmark Set Opener と同じ)。`popup.css` を `@import` しているので、ポップアップ専用の見出しは `.bar` / `.gear-btn` と名前を分けている。`options.css` は `popup.css` を `@import` している |
| `export-file.js` | エクスポート先(選んだフォルダ + ファイル名)への上書き。Bookmark Set Opener のものをそのまま持ってきた(ファイル名の初期値だけ `window-presets-<ブラウザ>.json`) |
| `icons/icon.svg` | アイコンの原本(タイトルバー付きの窓に斜めの矢印。ユーザーが6案から選んだ。縦長専用に見える案は、横型への振り分けにも使うので外した)。PNG はここから `rsvg-convert` で書き出す |

## ストレージ

- `chrome.storage.sync`: `enabled`(既定 true)、`presets: [{ id, name, left, top, width, height, urls: [], keywords: [], isDefault? }]`。**配列の順が優先度**(先頭ほど優先)。`isDefault` は多くても1つ
- `chrome.storage.session`: `applied: { [windowId]: presetId }` — ウィンドウごとに最後に当てたプリセット
- `chrome.storage.session`: `ytReports: { [tabId]: { url, videoId, isLive, title } }` — YouTube のページからの最新の報告。ポップアップも読む

## 中心にある設計判断

### 「設定(位置とサイズ)」に URL をぶら下げる

ユーザーの要望。縦型配信・横長など**見せ方ごとに1つの位置とサイズ**があり、そこにチャンネルを足していく使い方なので、
URL ごとに位置とサイズを持たせず、プリセット1つに URL を複数紐づける形にした。登録は数値を打たせず、
今のウィンドウから `chrome.windows.getCurrent()` で読み取る。

### 当てるのは「当たるページに来たとき」の1回だけ

対象はアクティブなタブ(`tab.active`)。`tabs.onUpdated`(`changeInfo.url`)と `tabs.onActivated` で判定する。
YouTube はページを読み込み直さずに遷移する(pushState)が、`changeInfo.url` は来る。YouTube ではさらに、ページ内の
`yt-main.js` からの報告(`yt-report` メッセージ)を受けたときにも判定する(「YouTube は配信中のページだけ」の節)。

毎回当てると、適用後に手で調整したウィンドウが同じサイト内の遷移のたびに戻されて邪魔になる。そこでウィンドウごとに
`applied` を持ち、**同じプリセットなら当て直さない**。当たらないページがアクティブになったら `applied` を消すので、
他のページを挟んで戻ってくれば、また当たる。ウィンドウを閉じたら消す。

元のサイズへ戻す機能は付けていない(要望になかった)。付けるなら、当てる直前の位置とサイズを `applied` と一緒に持つ。

### イベントは1本の列で処理する

`/other` → `/target` のように遷移が続くと、「当たらない」判定の `applied` 消去と、「当たる」判定の読み取りが
並行して入れ違い、再適用されないことがあった(E2E で再現)。`enqueue()` で直列化している。
ポップアップの「適用」メッセージも同じ列に並べる。

### 最大化・フルスクリーンは先に normal に戻す

その状態のまま `left/top/width/height` は指定できない。`state: "normal"` にしてから、state が normal になるまで
最大 2 秒待ち、フルスクリーンからだった場合は macOS のアニメーションのぶん 400ms 足してから位置とサイズを当てる。

### 「適用」はポップアップでなく background で行う

ウィンドウが動くとポップアップは閉じるので、処理はメッセージで background に渡す。

### 権限は `tabs` と `storage`、YouTube への content script

`webNavigation` にすると `host_permissions` が要る。`tabs` があれば `tab.url` と `changeInfo.url` を読める。
`chrome.windows` に権限は要らない。YouTube の配信判定のため `www.youtube.com` に content script を入れている(次の節)。

## URL パターンの仕様(`rules.js`)

- 前方一致。ただしパターンの続きが `/` `?` `#` か末尾のときだけ当たる(`…/live` が `…/livestream` に当たらないように)。
  パターンが `/ ? # & = *` で終わるなら、続きは何でもよい
- `*` は任意の文字列。`*` だけ(全ページ)は受け付けない
- スキームを省くと `https?://` を補う。大文字小文字は区別しない
- 複数のプリセットに当たったときの選び方は「優先度(並び順)」の節
- ポップアップの紐づけ欄の初期値(`suggestPattern`)はハッシュを落とし、`?si=` のような付け足しのクエリも落とす。
  ただし `/watch` など、クエリが本体のパスでは残す

YouTube の `https://www.youtube.com/@<channel>/live` は、配信ページを開いたあとも URL がそのまま残る(2026-11-27 に確認)。
ただし、チャンネルページから配信のサムネイルを押して入ると `/watch?v=…` になるので、`/live` のパターンには当たらない。
これを拾うために、次のタイトルのキーワードを足した。

## YouTube は配信中のページだけ

ユーザーの要望: **YouTube の配信だけを対象にし、通常の動画・ショートには反応しない。**「配信」は**今配信中**(`isLive`)とした。
アーカイブ(配信が終わったもの。`isLiveContent` は true だが `isLive` は false)も対象外。

### 配信かどうかの読み方

URL(`/watch?v=…`)もタブのタイトルも、通常の動画と配信で区別がつかない。ページの要素の属性も当てにならない
(`ytd-watch-flexy` の `live-chat-present-and-expanded` はチャット欄の開閉で変わる。ライブバッジは表示の都合で出たり消えたり)。
**プレイヤー `#movie_player` の `getVideoData()`** が `{ video_id, isLive, title }` を返すので、これを使う(2026-11-27 に実機で確認)。

- `getVideoData()` はページの JS のメソッドなので **MAIN world**(`content_scripts` の `"world": "MAIN"`)でしか呼べない。
  MAIN world からは `chrome.runtime` を呼べないので、ISOLATED world の `yt-bridge.js` が `CustomEvent` を受けて background へ送る。
  `detail` は world をまたぐとオブジェクトが渡らないことがあるので JSON 文字列にしている
- 報告のきっかけ: `yt-navigate-finish` / `yt-page-data-updated` / 初回読み込み。プレイヤーの中身は遷移の完了より遅れて
  入れ替わるので、そのあと 10 秒だけ 0.5 秒おきに見て、内容が変わったら報告する
- **前の動画の情報が残る対策**: `/watch?v=ID` と `/live/ID` はプレイヤーの `video_id` がその ID になるまで報告しない。
  `/@channel/live` は URL に ID が無いので、遷移(`yt-navigate-start`)から 3 秒は前と同じ動画のままなら報告しない。
  background 側でも `reportMatches` で、報告の URL(と `/watch` なら動画 ID)が今のタブと合うかを確かめる
- タイトルもプレイヤーのものを使う(末尾の ` - YouTube` や通知件数が付かない)。以前はタブのタイトルを使っていて、
  「URL が先に変わり、タイトルは 0.5 秒遅れる」「ブラウザの『戻る』では逆にタイトルが先」という順番の問題に
  `staleTitles`(2 秒の期限付き)で対処していたが、プレイヤーから読むようにして要らなくなった

### 判定(`resolve`)

- YouTube 以外: URL パターンだけで決める
- YouTube で `isYouTubeVideoPage` でないページ(トップ・検索・チャンネルの動画一覧・**ショート**など): 対象外(`notLive`)。
  **ショートは別のプレイヤーで再生され、`#movie_player` には前に見ていた配信の情報(`isLive: true`)が残っている**
  (E2E で確認)。報告だけを信じると誤って当てるので、URL の時点で外している
- YouTube の配信があり得るページ(`/watch`、`/live/ID`、`/@…/live` など): 今のページの報告が届くまで `pending`(何も決めない)。
  届いて `isLive` でなければ対象外(`notLive`)。配信なら URL パターンとタイトルのキーワードの両方の候補から選ぶ
- `pending` の間に `applied` を消さないのは、縦型配信から縦型配信へ移ったときに一度「当たらない」扱いになり、
  手で調整したウィンドウを当て直してしまうから。`notLive` では消す(次に配信へ来たらまた当てる)

## タイトルのキーワード(`keywords`)

ユーザーの要望で追加(縦型配信のタイトルには `#縦型配信` などが入る)。プリセットごとに `keywords: []` を持つ
(これより前に作ったプリセットには無いので、常に `p.keywords || []` で読む)。

- YouTube の配信のタイトルでだけ見る(全ページのタブのタイトルで見ると「縦型」で検索した Google の結果などにも当たる)
- 部分一致。`foldText`(NFKC + 小文字)で全角半角・大文字小文字をそろえる。正規表現は入れていない
- キーワードの行頭 `#` はコメント扱いにしない(URL パターンとは逆)

## 優先度(並び順)

想定している使い方(ユーザー指定): **縦型配信は設定1、残りの配信は設定2 に振り分ける。**
設定1 = キーワード `#縦型配信`(+ 縦型のチャンネルの `/live`)、設定2 = 「デフォルトを有効」(URL もキーワードも無し)。

- URL で当たった候補(`urlCandidates`)と、YouTube の配信のタイトルで当たった候補(`titleCandidates`)のうち、
  **`presets` 配列で前にある(= 設定画面で上にある)方**を `pick` で選ぶ。同じ設定に URL とタイトルの両方で当たったら表示は URL
- 経緯: 最初は「URL 優先・URL どうしは長いパターン」、次に「YouTube ではタイトルを先に見る」決め打ち、次に数値の `priority`
  (同点なら URL 優先 → 長い方)と変わり、最後にユーザーの希望で**カードのドラッグによる並び順**にした。
  長いパターンを優先する規則はもう無い(チャンネル単位の URL を広い URL に勝たせたいなら上に置く)
- 数値の `priority` を持つ設定が残っていたら、`migratePriority` が優先度の高い順(同点は元の順)に並べて `priority` を消す。
  `onInstalled` / `onStartup` で一度だけ走る
- 新しく登録した設定は末尾(いちばん低い優先度)に入る

### デフォルト(`isDefault`)

ユーザーの要望: 大半の配信は横型なので、縦型以外は URL を書かずに横型へ切り替えたい。カードの「デフォルトを有効」トグル。

- **YouTube の配信中のページで、URL にもキーワードにも当たらなかったときだけ**使う(`resolve` の最後。`by: "default"`)。
  並び順より弱い(デフォルトの設定が上にあっても、下の設定に当たればそちらが勝つ)。YouTube 以外・通常の動画には使わない
- 1つだけ。設定画面でオンにすると、ほかの設定の `isDefault` を false にして描き直す
- これで、以前の「横型の設定に `www.youtube.com/watch` と `www.youtube.com/@*/live` を書いて下に置く」運用は要らなくなった
  (書いてあっても同じ結果になる)

### 並べ替えの UI(`options.js`)

- HTML5 の drag and drop。カードを常に `draggable` にすると入力欄の文字を選べなくなるので、
  **つまみ(`.grip`)を `pointerdown` した間だけ `draggable = true`** にする
- `dragover` でポインタより下にある最初のカード(中心線で判定)の前へ DOM を直接動かして行き先を見せ、
  `dragend` で DOM の並びを読んで保存する
- `storage.onChanged` の描き直し判定(`shape`)に id の並びが入っているので、別タブで並べ替えても反映される。
  自分の保存は先に `presets` を更新してあるので描き直さない(入力中の欄を壊さない)

## エクスポート・インポート

ユーザーの要望で Bookmark Set Opener と同じ作りにした(設定画面の右上にボタン、その下にエクスポート先)。

- 形式は `rules.js` の `exportData` / `importData`: `{ format: "window-presets", version: 1, enabled, presets: [...] }`
- **インポートは置き換え**(Bookmark Set Opener は id で足し合わせる)。並び順が優先度なので、足し合わせると並びが崩れる。
  `importData` は形式名を確かめ、位置とサイズが数値でない設定があれば全体を拒否する。名前・URL・キーワードは
  設定画面と同じ正規化をかけ、幅と高さは下限に寄せ、重複した id は振り直し、`isDefault` は最初の1つだけ残す
- エクスポート先: `showDirectoryPicker` でフォルダを選び、そのハンドルとファイル名を IndexedDB(拡張機能のオリジン)に覚える。
  使えないブラウザ(Brave。テスト用の Brave Nightly も)ではダウンロードになる
- E2E: Brave ではダウンロードを CDP の `Browser.setDownloadBehavior` で受けて中身を確かめ、そのファイルをインポートして元に戻ることを確認した。
  フォルダを選ぶ経路は、`showDirectoryPicker` を書き込みを記録するだけの偽物に差し替えて確かめた。偽物のハンドルは
  IndexedDB に保存できない(関数を持つので複製できない)ので、テストでは `IDBObjectStore.prototype.put` で名前だけに置き換える

## テスト

```sh
node --test test/
```

E2E は `browser-testing` skill の手順(Playwright + Brave Nightly をバックグラウンドで起動)で、スクラッチパッドに書いて回した。
確認した項目: 当たらないページでは何もしない / 通常の遷移で当たる / 同じプリセットのページ内遷移では当て直さない /
当たらないページを挟めば pushState でも当て直す / 最大化からでも当たる / オフでは何もしない。
実際の YouTube では、縦型配信の設定(キーワード `#縦型配信`)を上、横型の設定(`www.youtube.com/watch`・`www.youtube.com/@*/live`)を下に置き、
縦型配信 → 通常の動画(関連動画のリンクを `click()`)→ 24 時間配信している横型のチャンネルの `/@…/live`→ ショート(`/shorts` を開くと適当な1本へ飛ぶ)
→ 縦型配信、の順に移って、ウィンドウのサイズを 0.1 秒ごとに見た。縦型配信は縦、通常の動画とショートは何もしない(適用の記録だけ消える)、
横型の配信は横、になり、途中で逆の設定を挟まないことを確認した。関連動画が配信のこともある(将棋の中継に当たった)ので、
移動先が配信だったら「通常の動画」の確認はスキップする。
並べ替えは Playwright の `locator.dragTo()`(HTML5 のドラッグイベントが飛ぶ)で、つまみで上下に動かせること、
名前欄からドラッグしても並べ替わらないことを確認した。

E2E のハマりどころ:

- **起動して約3秒後に、テスト用ブラウザのウィンドウが外から最大化される。** 拡張を空設定にしても起きるので、拡張とは無関係。
  開いてから 4 秒待ってから検証を始める。これを知らずに、再適用の不具合と取り違えて時間を使った
- **Brave はウィンドウの最小幅が 500px を超える**(幅 520 を指定して 536 になった)。テストの幅は 600 以上にする
- `background-browser.js` の `openPage(url, { width, height })` は `chrome-extension://` のページだと待ちがタイムアウトする。
  拡張のページのスクリーンショットはサイズ指定なしで開く
