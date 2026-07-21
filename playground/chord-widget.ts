// コード譜ウィジェットのクライアントランタイム。
// タブ切替（ディグリー ⇄ コード）・移調・再生・画像コピーを
// document への委譲イベントで処理する。ウィジェット HTML 自体は
// chord-language の render_widget_html が生成する（単一ソース）ため、
// SSR ページでもライブプレビューでも、このモジュールを一度読み込むだけで動く。
// @ts-ignore -- MoonBit ビルド出力 (型定義なし)
import { parse_to_notes_html, parse_to_playback, chord_css } from "../_build/js/release/build/seo1nk/chord_language/chord_language.js";

let installed = false;

// ---- 再生 ----
// スケジュール(ディグリー→MIDI・拍割り付け)は MoonBit 側の parse_to_playback が
// 生成し、ここでは Web Audio の発音とカーソルハイライトだけを行う。
interface PlaybackData {
  bpm: number;
  totalBeats: number;
  events: { beat: number; dur: number; notes: number[] }[];
  bass: { beat: number; dur: number; note: number; gain?: number }[];
  // 複合拍子(6/8 等)の「ちゃっちゃ」= 上声和音の短い刻み
  stabs?: { beat: number; dur: number; notes: number[] }[];
  cursor: { beat: number; dur: number; cell: number }[];
}

interface Player {
  widget: HTMLElement;
  ctx: AudioContext | null;
  timers: number[];
  cells: HTMLElement[];
  button: HTMLElement;
  // 停止時に戻すボタンの中身(SSR 由来の再生アイコン)
  idleHtml: string;
}

let player: Player | null = null;

// ボタンの状態表示に使うアイコン(lucide 形式)。初期表示の play / camera は
// chord-language の render_widget_html が同じ形式で埋め込む(data-icon が目印)
function iconSvg(name: string, body: string): string {
  return (
    `<svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="currentColor"` +
    ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-icon="${name}">${body}</svg>`
  );
}

const STOP_ICON = iconSvg("stop", '<rect width="18" height="18" x="3" y="3" rx="2"/>');
const CHECK_ICON = iconSvg("check", '<path d="M20 6 9 17l-5-5"/>');
const X_ICON = iconSvg("x", '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');

// 音作りの定数(値を変えると鳴り方が変わる。経緯は git ログ参照)
const LEAD_IN = 0.08; // 再生開始までの猶予(秒)
const MASTER_GAIN = 0.9;
const PAD_GAP = 0.06; // 持続和音どうしの隙間(秒。次のコードと重ねない)
const PAD_RELEASE = 0.09; // 持続和音のリリース(秒)
const PAD_PEAK = 0.28; // 持続和音のピーク(÷√音数)
const STAB_PEAK = 0.55; // スタブのピーク(÷√音数。パッドより強いアタックでリズムを出す)
const BASS_PEAK = 0.8; // ベースのピーク(上声より大きめ・ユーザー指定)

function stopPlayback(): void {
  if (!player) return;
  for (const t of player.timers) clearTimeout(t);
  for (const c of player.cells) c.classList.remove("chord-cell--playing");
  for (const chip of Array.from(
    player.widget.querySelectorAll<HTMLElement>(".chord-mod--playing"),
  )) {
    chip.classList.remove("chord-mod--playing");
  }
  if (player.ctx) {
    void player.ctx.close().catch(() => {});
  }
  player.button.innerHTML = player.idleHtml;
  player.button.setAttribute("aria-label", "再生");
  player.button.setAttribute("title", "表示中のキーで再生");
  player = null;
}

function midiToFreq(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

// 三角波 1 音ぶんのオシレータ + ゲインを master につないで返す
function voice(ctx: AudioContext, master: GainNode, note: number): { osc: OscillatorNode; gain: GainNode } {
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = midiToFreq(note);
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(master);
  return { osc, gain };
}

// プラッキーな 1 音(アタック後すぐ減衰しきる。ベースとスタブで共用)
function pluck(
  ctx: AudioContext,
  master: GainNode,
  note: number,
  start: number,
  stop: number,
  peak: number,
  attack: number,
  minDecay: number,
): void {
  const { osc, gain } = voice(ctx, master, note);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, Math.max(start + minDecay, stop));
  osc.start(start);
  osc.stop(stop + 0.01); // ゲインが 0 に達してから停止(クリック防止)
}

// 上声の持続和音(減衰 → 保持 → リリース。値のジャンプなし = クリックノイズなし)
function schedulePads(ctx: AudioContext, master: GainNode, data: PlaybackData, t0: number, spb: number): void {
  for (const ev of data.events) {
    const start = t0 + ev.beat * spb;
    const stop = start + ev.dur * spb - PAD_GAP; // 実際の消音完了時刻
    const attackEnd = start + 0.02;
    const peak = PAD_PEAK / Math.sqrt(Math.max(1, ev.notes.length));
    const sustain = peak * 0.5;
    // 減衰の終点とリリース開始点(短い音でも順序が崩れないようクランプ)
    const decayEnd = Math.min(start + Math.max(0.1, (stop - start) * 0.6), stop - PAD_RELEASE);
    for (const note of ev.notes) {
      const { osc, gain } = voice(ctx, master, note);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(peak, attackEnd);
      if (decayEnd > attackEnd) {
        gain.gain.exponentialRampToValueAtTime(sustain, decayEnd);
        gain.gain.setValueAtTime(sustain, Math.max(decayEnd, stop - PAD_RELEASE));
      }
      gain.gain.exponentialRampToValueAtTime(0.0001, stop);
      osc.start(start);
      osc.stop(stop + 0.01);
    }
  }
}

// スタブ: 複合拍子の弱拍(ちゃっちゃ)。和音を短くプラッキーに刻む
function scheduleStabs(ctx: AudioContext, master: GainNode, data: PlaybackData, t0: number, spb: number): void {
  for (const s of data.stabs ?? []) {
    const start = t0 + s.beat * spb;
    const stop = start + s.dur * spb - 0.03;
    const peak = STAB_PEAK / Math.sqrt(Math.max(1, s.notes.length));
    for (const note of s.notes) {
      pluck(ctx, master, note, start, stop, peak, 0.01, 0.06);
    }
  }
}

// ベーストラック: 拍ごとにプラッキーに刻む(gain は「ずんちゃっちゃ」の強弱)
function scheduleBass(ctx: AudioContext, master: GainNode, data: PlaybackData, t0: number, spb: number): void {
  for (const b of data.bass) {
    const start = t0 + b.beat * spb;
    const stop = start + b.dur * spb - 0.03;
    pluck(ctx, master, b.note, start, stop, BASS_PEAK * (b.gain ?? 1), 0.012, 0.05);
  }
}

function scheduleAudio(ctx: AudioContext, data: PlaybackData, spb: number): void {
  const t0 = ctx.currentTime + LEAD_IN;
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(ctx.destination);
  schedulePads(ctx, master, data, t0, spb);
  scheduleStabs(ctx, master, data, t0, spb);
  scheduleBass(ctx, master, data, t0, spb);
}

// AudioContext を用意し、再生可能になり次第スケジュールする。
// 使えない環境では null を返す(カーソル表示だけは動かす)
function setupAudio(data: PlaybackData, spb: number): AudioContext | null {
  try {
    // iOS: サイレントスイッチ(マナーモード)中も鳴らせるよう、
    // オーディオセッションを「再生」用途として宣言する(対応環境のみ)
    const session = (navigator as { audioSession?: { type: string } }).audioSession;
    if (session) {
      try {
        session.type = "playback";
      } catch {
        // 未対応の値などは無視
      }
    }
    const ctx = new AudioContext();
    // モバイルでは生成直後が suspended のことがある。resume の完了を待ってから
    // スケジュールしないと、止まった時計(currentTime)基準で予約されて無音になる
    const schedule = () => {
      if (player && player.ctx === ctx) scheduleAudio(ctx, data, spb);
    };
    if (ctx.state === "suspended") {
      ctx.resume().then(schedule, schedule);
    } else {
      scheduleAudio(ctx, data, spb);
    }
    return ctx;
  } catch {
    return null;
  }
}

// 再生カーソルが転調をまたいだ瞬間、そのセルに対応する転調チップを一瞬点灯させる。
// 対象: セル内の前置チップ + 行頭セルなら直前の転調バッジ行(.chord-modline)のチップ
const KEY_CHIP_FLASH_MS = 700;
function flashKeyChips(cell: HTMLElement): void {
  const chips = Array.from(
    cell.querySelectorAll<HTMLElement>(":scope > .chord-mod:not(.chord-mod--after)"),
  );
  const line = cell.parentElement;
  if (line && line.firstElementChild === cell) {
    // セクションバッジを挟むこともあるので、modline / section の連なりを遡る
    let prev = line.previousElementSibling;
    while (
      prev &&
      (prev.classList.contains("chord-modline") || prev.classList.contains("chord-section"))
    ) {
      if (prev.classList.contains("chord-modline")) {
        chips.push(...Array.from(prev.querySelectorAll<HTMLElement>(".chord-mod")));
      }
      prev = prev.previousElementSibling;
    }
  }
  for (const chip of chips) {
    chip.classList.add("chord-mod--playing");
    window.setTimeout(() => chip.classList.remove("chord-mod--playing"), KEY_CHIP_FLASH_MS);
  }
}

// カーソル: 表示中のタブのセルを再生位置に合わせてハイライトする
function scheduleCursor(widget: HTMLElement, data: PlaybackData, spb: number): { cells: HTMLElement[]; timers: number[] } {
  const cells = Array.from(
    widget.querySelectorAll<HTMLElement>(`.chord-panel--${activePanel(widget)} .chord-cell`),
  );
  const timers: number[] = [];
  for (const cur of data.cursor) {
    timers.push(
      window.setTimeout(
        () => {
          for (const c of cells) c.classList.remove("chord-cell--playing");
          const cell = cells[cur.cell];
          if (cell) {
            cell.classList.add("chord-cell--playing");
            flashKeyChips(cell);
          }
        },
        (LEAD_IN + cur.beat * spb) * 1000,
      ),
    );
  }
  timers.push(
    window.setTimeout(() => stopPlayback(), (LEAD_IN + data.totalBeats * spb) * 1000 + 200),
  );
  return { cells, timers };
}

// 再生データを fromBeat 以降に切り出す(セルタップの部分再生・シーク用)。
// 持続音(events)と表示(cursor)は fromBeat をまたぐ要素の頭を切り詰めて残し、
// 打音(bass/stabs)は途中から鳴らすと不自然なので開始拍が fromBeat 以降のものだけ残す
function slicePlayback(data: PlaybackData, fromBeat: number): PlaybackData {
  const shiftSpan = <T extends { beat: number; dur: number }>(xs: T[]): T[] =>
    xs
      .filter((x) => x.beat + x.dur > fromBeat)
      .map((x) => ({
        ...x,
        beat: Math.max(0, x.beat - fromBeat),
        dur: x.beat + x.dur - Math.max(x.beat, fromBeat),
      }));
  const shiftHit = <T extends { beat: number }>(xs: T[]): T[] =>
    xs.filter((x) => x.beat >= fromBeat).map((x) => ({ ...x, beat: x.beat - fromBeat }));
  return {
    ...data,
    totalBeats: data.totalBeats - fromBeat,
    events: shiftSpan(data.events),
    bass: shiftHit(data.bass),
    stabs: data.stabs ? shiftHit(data.stabs) : data.stabs,
    cursor: shiftSpan(data.cursor),
  };
}

function startPlayback(widget: HTMLElement, button: HTMLElement, fromBeat: number = 0): void {
  stopPlayback();
  const src = widget.dataset.chordSrc ?? "";
  const key = widget.dataset.chordKey ?? "C";
  let data: PlaybackData;
  try {
    data = JSON.parse(parse_to_playback(src, key));
  } catch {
    return;
  }
  if (fromBeat > 0) data = slicePlayback(data, fromBeat);
  if (data.totalBeats <= 0) return;
  const spb = 60 / (data.bpm || 120);
  const idleHtml = button.innerHTML;
  button.innerHTML = STOP_ICON;
  button.setAttribute("aria-label", "停止");
  button.setAttribute("title", "停止");
  // setupAudio 内の schedule ガードが player.ctx を参照するため、先に player を確定させる
  const { cells, timers } = scheduleCursor(widget, data, spb);
  player = { widget, ctx: null, timers, cells, button, idleHtml };
  player.ctx = setupAudio(data, spb);
}

// セルタップ: そのセルの開始拍から再生する(停止中 = 部分再生、再生中 = シーク)。
// 「サビの転調だけ聴きたい」ときに毎回頭から聴かなくて済むようにする
function playFromCell(widget: HTMLElement, cell: HTMLElement): void {
  const button = widget.querySelector<HTMLElement>(".chord-play");
  if (!button) return;
  const cells = Array.from(
    widget.querySelectorAll<HTMLElement>(`.chord-panel--${activePanel(widget)} .chord-cell`),
  );
  const idx = cells.indexOf(cell);
  if (idx < 0) return;
  const src = widget.dataset.chordSrc ?? "";
  const key = widget.dataset.chordKey ?? "C";
  let data: PlaybackData;
  try {
    data = JSON.parse(parse_to_playback(src, key));
  } catch {
    return;
  }
  // このセルに対応する最初のカーソル区間の開始拍(空拍セルなどは対象外)
  const cur = data.cursor.find((c) => c.cell === idx);
  if (!cur) return;
  startPlayback(widget, button, cur.beat);
}

// ---- 画像コピー ----

// 表示中のタブ名("degree" | "notes")
function activePanel(widget: HTMLElement): string {
  return widget.dataset.chordActive === "notes" ? "notes" : "degree";
}

// ---- 譜面のフィット ----
// 譜面(.chord-score)が親パネルの幅からはみ出すとき(主にモバイル)、
// パネルの font-size を縮めて譜面全体を横幅に収める。レイアウトは em 基準
// なので、フォントサイズの縮小がほぼそのまま譜面全体の縮小になる。
// 画像コピーは scoreToBlob 側で縮小を解除して常に等倍で書き出す。
const FIT_MIN_SCALE = 0.5; // これ以上は縮めない(以降は横スクロールに任せる)

function fitScore(widget: HTMLElement): void {
  const panel = widget.querySelector<HTMLElement>(`.chord-panel--${activePanel(widget)}`);
  const score = panel?.querySelector<HTMLElement>(".chord-score");
  if (!panel || !score) return;
  panel.style.fontSize = ""; // 等倍に戻して自然幅を測る
  const avail = panel.clientWidth;
  if (avail <= 0) return;
  if (score.scrollWidth <= avail) return;
  // 右端ぴったりに収めると最終セルの小節線(border-right)が overflow で
  // クリップされて薄く見えるため、2px だけ内側を狙う
  const target = Math.max(50, avail - 2);
  // 罫線など px 固定の要素があり縮小は完全な線形ではないため、
  // 1 回で収まらなければもう一段だけ詰める
  let scale = 1;
  for (let i = 0; i < 3 && score.scrollWidth > target && scale > FIT_MIN_SCALE; i++) {
    scale = Math.max(FIT_MIN_SCALE, scale * (target / score.scrollWidth));
    panel.style.fontSize = `${scale}em`;
  }
}

let fitObserver: ResizeObserver | null = null;
const fitWatched = new WeakSet<Element>();

// root 配下(root 自身を含む)のウィジェットをフィット監視の対象にする
function watchChordWidgets(root: Element | Document): void {
  if (!fitObserver) return;
  if (root instanceof Element && root.classList.contains("chord-widget") && !fitWatched.has(root)) {
    fitWatched.add(root);
    fitObserver.observe(root);
  }
  for (const w of root.querySelectorAll(".chord-widget")) {
    if (!fitWatched.has(w)) {
      fitWatched.add(w);
      fitObserver.observe(w);
    }
  }
}

// 表示中の譜面 (.chord-score) を PNG Blob にする。
// 外部ライブラリを使わず、譜面 HTML + chord_css を SVG の foreignObject に
// 埋め込んで canvas に描く (スタイルが自前 CSS で完結しているため成立する)。
// 画像は貼り付け先を選ばないよう、ページのテーマによらず常にライトテーマで書き出す。
async function scoreToBlob(score: HTMLElement): Promise<Blob> {
  // フィット縮小(親パネルの font-size)を一時的に解除し、自然サイズで測る
  // (画像はモバイルでも常に等倍で書き出す)。測定と HTML の採取は同期なので
  // 画面にちらつきは出ない
  const fitPanel = score.parentElement;
  const savedFit = fitPanel?.style.fontSize ?? "";
  if (fitPanel) fitPanel.style.fontSize = "";
  // ページ上の実フォントサイズで書き出す。固定 16px にすると、ページ側が
  // 16px 以外(例: 記事本文が 15px)のとき採寸と描画がずれて下が見切れる
  const baseFontSize = getComputedStyle(score).fontSize;
  const width = Math.ceil(score.scrollWidth);
  const height = Math.ceil(score.scrollHeight);
  // 再生中のセルハイライトは画像に写さない
  const scoreHtml = score.outerHTML
    .replace(/\s*\bchord-cell--playing\b/g, "")
    .replace(/\s*\bchord-mod--playing\b/g, "");
  if (fitPanel) fitPanel.style.fontSize = savedFit;
  const pad = 16;
  const totalW = width + pad * 2;
  const totalH = height + pad * 2;
  const wrapperStyle = [
    `width:${width}px`,
    "background:#ffffff",
    "color:#1f2328",
    `padding:${pad}px`,
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans','Helvetica Neue',Arial,sans-serif",
    `font-size:${baseFontSize}`,
    "line-height:1.5",
  ].join(";");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${wrapperStyle}">` +
    `<style>${chord_css()}</style>` +
    scoreHtml +
    `</div></foreignObject></svg>`;
  const img = new Image();
  img.decoding = "sync";
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("svg render failed"));
  });
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await loaded;
  const scale = 2; // 高解像度で書き出す
  const canvas = document.createElement("canvas");
  canvas.width = totalW * scale;
  canvas.height = totalH * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("toBlob failed"));
    }, "image/png");
  });
}

// 画面下部に一瞬だけ出すトースト(コピー結果の通知)
let toastTimer = 0;
function showToast(message: string): void {
  document.querySelector(".chord-toast")?.remove();
  clearTimeout(toastTimer);
  const toast = document.createElement("div");
  toast.className = "chord-toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("chord-toast--show"));
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("chord-toast--show");
    setTimeout(() => toast.remove(), 300);
  }, 1800);
}

// クリップボードに書けない環境ではダウンロードにフォールバックする
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyScoreImage(widget: HTMLElement, button: HTMLElement): Promise<void> {
  const score = widget.querySelector<HTMLElement>(`.chord-panel--${activePanel(widget)} .chord-score`);
  if (!score) return;
  // ボタンの中身はカメラアイコン(SVG)なので innerHTML で控えて戻す
  const original = button.innerHTML;
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      // Safari 対応: ユーザー操作の同期文脈で Promise を渡す形にする
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": scoreToBlob(score) }),
      ]);
    } else {
      downloadBlob(await scoreToBlob(score), "chord-score.png");
    }
    button.innerHTML = CHECK_ICON;
    showToast("コピーしました");
  } catch {
    try {
      downloadBlob(await scoreToBlob(score), "chord-score.png");
      button.innerHTML = CHECK_ICON;
      showToast("画像を保存しました");
    } catch {
      button.innerHTML = X_ICON;
      showToast("コピーに失敗しました");
    }
  }
  setTimeout(() => {
    button.innerHTML = original;
  }, 1600);
}

// ---- イベント委譲 ----

// el から最も近い .chord-widget(自分がウィジェット外なら null)
function widgetOf(el: HTMLElement): HTMLElement | null {
  return el.closest(".chord-widget") as HTMLElement | null;
}

function handleClick(ev: MouseEvent): void {
  const target = ev.target as HTMLElement | null;
  if (!target?.closest) return;

  const playBtn = target.closest(".chord-play") as HTMLElement | null;
  if (playBtn) {
    const widget = widgetOf(playBtn);
    if (widget) {
      if (player && player.widget === widget) {
        stopPlayback();
      } else {
        startPlayback(widget, playBtn);
      }
    }
    return;
  }

  const copyBtn = target.closest(".chord-copy-img") as HTMLElement | null;
  if (copyBtn) {
    const widget = widgetOf(copyBtn);
    if (widget) {
      void copyScoreImage(widget, copyBtn);
    }
    return;
  }

  const spellBtn = target.closest(".chord-spell") as HTMLElement | null;
  if (spellBtn) {
    handleSpellToggle(spellBtn);
    return;
  }

  // コードセルのタップ = そのセルから再生(テキスト選択中は誤発火させない)
  const cell = target.closest(".chord-cell") as HTMLElement | null;
  if (cell) {
    const widget = widgetOf(cell);
    if (widget && (window.getSelection()?.toString() ?? "") === "") {
      playFromCell(widget, cell);
    }
    return;
  }

  // タブ切替(パネルの表示切替は chord_css の data-chord-active ルールが行う)
  const tab = target.closest(".chord-tab") as HTMLElement | null;
  if (!tab) return;
  const widget = widgetOf(tab);
  const mode = tab.dataset.chordTab;
  if (!widget || !mode) return;
  widget.dataset.chordActive = mode;
  for (const el of widget.querySelectorAll<HTMLElement>(".chord-tab")) {
    el.classList.toggle("chord-tab--active", el.dataset.chordTab === mode);
  }
  // 再生中の切替は、カーソルの対象セルを新しいパネルへ差し替える(旧パネルに
  // ハイライトが残ったまま進む不具合の修正)。スケジュール済みタイマーは
  // この配列を閉包で共有しているため、参照を保ったまま中身を入れ替える
  if (player && player.widget === widget) {
    const newCells = Array.from(
      widget.querySelectorAll<HTMLElement>(`.chord-panel--${activePanel(widget)} .chord-cell`),
    );
    const idx = player.cells.findIndex((c) => c.classList.contains("chord-cell--playing"));
    for (const c of player.cells) c.classList.remove("chord-cell--playing");
    if (idx >= 0 && newCells[idx]) newCells[idx].classList.add("chord-cell--playing");
    player.cells.splice(0, player.cells.length, ...newCells);
  }
  // 切り替わったパネルは非表示中に測れていないのでここでフィットする
  fitScore(widget);
}

// 選択キーで notes パネルを再レンダリング
// (移調ロジックは MoonBit 側の parse_to_notes_html を呼ぶ — 二重実装しない)
function applySelectedKey(widget: HTMLElement, key: string): void {
  if (player && player.widget === widget) {
    stopPlayback();
  }
  const src = widget.dataset.chordSrc ?? "";
  widget.dataset.chordKey = key;
  const panel = widget.querySelector(".chord-panel--notes");
  if (panel) {
    panel.innerHTML = parse_to_notes_html(src, key);
  }
  // 音名の長さでスコア幅が変わることがあるので測り直す
  fitScore(widget);
}

// キープルダウンの変更
function handleKeyChange(ev: Event): void {
  const select = ev.target as HTMLSelectElement | null;
  if (!select?.classList?.contains("chord-key-select")) return;
  const widget = widgetOf(select);
  if (!widget) return;
  applySelectedKey(widget, select.value);
}

// ♯/♭トグル: プルダウンの黒鍵スロットの綴りを ♯ 側へ一括で切り替える。
// OFF では元の綴り(宣言キーの置き換えスロット含む)へ戻す。
// 選択中のキーの綴りが変わったときは notes パネルも綴り直す
// (綴りの優先度は選択キー名が運ぶ — MoonBit 側 spelling_pref)
const SHARP_SPELLINGS: Record<string, string> = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
};

function handleSpellToggle(btn: HTMLElement): void {
  const widget = widgetOf(btn);
  const select = widget?.querySelector<HTMLSelectElement>(".chord-key-select");
  if (!widget || !select) return;
  const sharp = btn.getAttribute("aria-pressed") !== "true";
  btn.setAttribute("aria-pressed", String(sharp));
  const label = sharp ? "元の綴りに戻す" : "♯表記に切り替え";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  const before = select.value;
  for (const opt of Array.from(select.options)) {
    if (sharp) {
      const to = SHARP_SPELLINGS[opt.value];
      if (to) {
        // 元の綴り(宣言キーの置き換えを含む)を覚えてから ♯ 側へ
        opt.dataset.origValue = opt.value;
        opt.value = to;
        opt.text = to;
      }
    } else if (opt.dataset.origValue) {
      opt.value = opt.dataset.origValue;
      // 表示ラベルは b → ♭(MoonBit 側 key_display_label と同じ規則)
      opt.text = opt.dataset.origValue.replace(/b/g, "♭");
      delete opt.dataset.origValue;
    }
  }
  if (select.value !== before) {
    applySelectedKey(widget, select.value);
  }
}

///
/// コード譜ウィジェットのランタイムを組み込む(ページに 1 回だけ呼ぶ)。
/// 表示用 CSS(chord_css)の注入もここで行う
export function installChordWidgets(): void {
  if (installed) return;
  installed = true;
  const style = document.createElement("style");
  // FIT_MIN_SCALE まで縮めても収まらない極端に長い譜面は横スクロールで逃がす
  style.textContent =
    chord_css() +
    "\n.chord-panel { overflow-x: auto; }" +
    "\n.chord-score .chord-cell { cursor: pointer; }" +
    "\n.chord-toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: rgba(28, 32, 38, 0.92); color: #fff; padding: 8px 16px; border-radius: 8px; font-size: 13px; z-index: 2000; opacity: 0; transition: opacity 0.25s; pointer-events: none; white-space: nowrap; }" +
    "\n.chord-toast--show { opacity: 1; }";
  document.head.appendChild(style);
  document.addEventListener("click", handleClick);
  document.addEventListener("change", handleKeyChange);
  // ウィジェットの幅変化(初期配置・画面回転・リサイズ)と、あとから
  // 挿入されるウィジェット(記事表示・ライブプレビュー)を監視してフィットする
  if (typeof ResizeObserver !== "undefined" && typeof MutationObserver !== "undefined") {
    fitObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        fitScore(entry.target as HTMLElement);
      }
    });
    watchChordWidgets(document);
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n instanceof Element) {
            watchChordWidgets(n);
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
}
