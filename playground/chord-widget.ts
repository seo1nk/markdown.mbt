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
}

let player: Player | null = null;

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
  if (player.ctx) {
    void player.ctx.close().catch(() => {});
  }
  player.button.textContent = "▶ 再生";
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
          cells[cur.cell]?.classList.add("chord-cell--playing");
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

function startPlayback(widget: HTMLElement, button: HTMLElement): void {
  stopPlayback();
  const src = widget.dataset.chordSrc ?? "";
  const key = widget.dataset.chordKey ?? "C";
  let data: PlaybackData;
  try {
    data = JSON.parse(parse_to_playback(src, key));
  } catch {
    return;
  }
  if (data.totalBeats <= 0) return;
  const spb = 60 / (data.bpm || 120);
  button.textContent = "■ 停止";
  // setupAudio 内の schedule ガードが player.ctx を参照するため、先に player を確定させる
  const { cells, timers } = scheduleCursor(widget, data, spb);
  player = { widget, ctx: null, timers, cells, button };
  player.ctx = setupAudio(data, spb);
}

// ---- 画像コピー ----

// 表示中のタブ名("degree" | "notes")
function activePanel(widget: HTMLElement): string {
  return widget.dataset.chordActive === "notes" ? "notes" : "degree";
}

// 表示中の譜面 (.chord-score) を PNG Blob にする。
// 外部ライブラリを使わず、譜面 HTML + chord_css を SVG の foreignObject に
// 埋め込んで canvas に描く (スタイルが自前 CSS で完結しているため成立する)。
// 画像は貼り付け先を選ばないよう、ページのテーマによらず常にライトテーマで書き出す。
async function scoreToBlob(score: HTMLElement): Promise<Blob> {
  const width = Math.ceil(score.scrollWidth);
  const height = Math.ceil(score.scrollHeight);
  const pad = 16;
  const totalW = width + pad * 2;
  const totalH = height + pad * 2;
  const wrapperStyle = [
    `width:${width}px`,
    "background:#ffffff",
    "color:#1f2328",
    `padding:${pad}px`,
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans','Helvetica Neue',Arial,sans-serif",
    "font-size:16px",
    "line-height:1.5",
  ].join(";");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${wrapperStyle}">` +
    `<style>${chord_css()}</style>` +
    score.outerHTML +
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
  const original = button.textContent;
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      // Safari 対応: ユーザー操作の同期文脈で Promise を渡す形にする
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": scoreToBlob(score) }),
      ]);
    } else {
      downloadBlob(await scoreToBlob(score), "chord-score.png");
    }
    button.textContent = "コピーしました ✓";
  } catch {
    try {
      downloadBlob(await scoreToBlob(score), "chord-score.png");
      button.textContent = "保存しました ✓";
    } catch {
      button.textContent = "失敗しました";
    }
  }
  setTimeout(() => {
    button.textContent = original;
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
}

// キープルダウン: 選択キーで notes パネルを再レンダリング
// (移調ロジックは MoonBit 側の parse_to_notes_html を呼ぶ — 二重実装しない)
function handleKeyChange(ev: Event): void {
  const select = ev.target as HTMLSelectElement | null;
  if (!select?.classList?.contains("chord-key-select")) return;
  const widget = widgetOf(select);
  if (!widget) return;
  if (player && player.widget === widget) {
    stopPlayback();
  }
  const src = widget.dataset.chordSrc ?? "";
  widget.dataset.chordKey = select.value;
  const panel = widget.querySelector(".chord-panel--notes");
  if (panel) {
    panel.innerHTML = parse_to_notes_html(src, select.value);
  }
}

///
/// コード譜ウィジェットのランタイムを組み込む(ページに 1 回だけ呼ぶ)。
/// 表示用 CSS(chord_css)の注入もここで行う
export function installChordWidgets(): void {
  if (installed) return;
  installed = true;
  const style = document.createElement("style");
  style.textContent = chord_css();
  document.head.appendChild(style);
  document.addEventListener("click", handleClick);
  document.addEventListener("change", handleKeyChange);
}
