// コード譜ウィジェットのクライアントランタイム。
// タブ切替（ディグリー ⇄ コード）とキープルダウンによる移調を
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

const LEAD_IN = 0.08; // 再生開始までの猶予(秒)

function scheduleAudio(ctx: AudioContext, data: PlaybackData, spb: number): void {
  const t0 = ctx.currentTime + LEAD_IN;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  // 次のコードと重ならないよう、発音は次の開始より少し手前で完全に終える
  const GAP = 0.06; // コード間の無音(秒)
  const RELEASE = 0.09; // リリース(秒)
  for (const ev of data.events) {
    const start = t0 + ev.beat * spb;
    const stop = start + ev.dur * spb - GAP; // 実際の消音完了時刻
    const attackEnd = start + 0.02;
    const peak = 0.28 / Math.sqrt(Math.max(1, ev.notes.length));
    const sustain = peak * 0.5;
    // 減衰の終点とリリース開始点(短い音でも順序が崩れないようクランプ)
    const decayEnd = Math.min(
      start + Math.max(0.1, (stop - start) * 0.6),
      stop - RELEASE,
    );
    for (const note of ev.notes) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = midiToFreq(note);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(peak, attackEnd);
      if (decayEnd > attackEnd) {
        // 減衰 → その値のまま保持 → 滑らかにリリース(値のジャンプなし)
        g.gain.exponentialRampToValueAtTime(sustain, decayEnd);
        g.gain.setValueAtTime(sustain, Math.max(decayEnd, stop - RELEASE));
      }
      g.gain.exponentialRampToValueAtTime(0.0001, stop);
      osc.connect(g);
      g.connect(master);
      osc.start(start);
      osc.stop(stop + 0.01); // ゲインが 0 に達してから停止(クリック防止)
    }
  }
  // スタブ: 複合拍子の弱拍(ちゃっちゃ)。和音を短くプラッキーに刻む。
  // 持続和音より強いアタックで立ち上げ、すぐ減衰させてリズムを出す
  for (const s of data.stabs ?? []) {
    const start = t0 + s.beat * spb;
    const stop = start + s.dur * spb - 0.03;
    const peak = 0.55 / Math.sqrt(Math.max(1, s.notes.length));
    for (const note of s.notes) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = midiToFreq(note);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(peak, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, Math.max(start + 0.06, stop));
      osc.connect(g);
      g.connect(master);
      osc.start(start);
      osc.stop(stop + 0.01);
    }
  }
  // ベーストラック: 拍ごとにプラッキーに刻む(素早い減衰で次の打と重ならない)
  for (const b of data.bass) {
    const start = t0 + b.beat * spb;
    const stop = start + b.dur * spb - 0.03;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiToFreq(b.note);
    const g = ctx.createGain();
    // ベースは上声より大きめに(ユーザー指定)。gain は複合拍子の
    // 「ずんちゃっちゃ」の強弱(スケジュール側が決める)
    const peak = 0.8 * (b.gain ?? 1);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, Math.max(start + 0.05, stop));
    osc.connect(g);
    g.connect(master);
    osc.start(start);
    osc.stop(stop + 0.01);
  }
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

  // 音: AudioContext が使えない環境でもカーソルは動かす
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
    void ctx.resume().catch(() => {});
    scheduleAudio(ctx, data, spb);
  } catch {
    ctx = null;
  }

  // カーソル: 表示中のタブのセルをハイライト
  const active = widget.dataset.chordActive === "notes" ? "notes" : "degree";
  const cells = Array.from(
    widget.querySelectorAll<HTMLElement>(`.chord-panel--${active} .chord-cell`),
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
    window.setTimeout(
      () => stopPlayback(),
      (LEAD_IN + data.totalBeats * spb) * 1000 + 200,
    ),
  );
  button.textContent = "■ 停止";
  player = { widget, ctx, timers, cells, button };
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
  const active = widget.dataset.chordActive === "notes" ? "notes" : "degree";
  const score = widget.querySelector<HTMLElement>(`.chord-panel--${active} .chord-score`);
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

export function installChordWidgets(): void {
  if (installed) return;
  installed = true;

  // タブ切替 / 画像コピー / 再生
  document.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement | null;
    const playBtn = target?.closest?.(".chord-play") as HTMLElement | null;
    if (playBtn) {
      const widget = playBtn.closest(".chord-widget") as HTMLElement | null;
      if (widget) {
        if (player && player.widget === widget) {
          stopPlayback();
        } else {
          startPlayback(widget, playBtn);
        }
      }
      return;
    }
    const copyBtn = target?.closest?.(".chord-copy-img") as HTMLElement | null;
    if (copyBtn) {
      const widget = copyBtn.closest(".chord-widget") as HTMLElement | null;
      if (widget) {
        void copyScoreImage(widget, copyBtn);
      }
      return;
    }
    // 記法チートシートの開閉(表示は chord_css の data-chord-help ルールが行う)
    const helpBtn = target?.closest?.(".chord-help") as HTMLElement | null;
    if (helpBtn) {
      const widget = helpBtn.closest(".chord-widget") as HTMLElement | null;
      if (widget) {
        if (widget.dataset.chordHelp === "open") {
          delete widget.dataset.chordHelp;
        } else {
          widget.dataset.chordHelp = "open";
        }
      }
      return;
    }
    const tab = target?.closest?.(".chord-tab") as HTMLElement | null;
    if (!tab) return;
    const widget = tab.closest(".chord-widget") as HTMLElement | null;
    const mode = tab.dataset.chordTab;
    if (!widget || !mode) return;
    widget.dataset.chordActive = mode;
    for (const el of widget.querySelectorAll<HTMLElement>(".chord-tab")) {
      el.classList.toggle("chord-tab--active", el.dataset.chordTab === mode);
    }
  });

  // キープルダウン: 選択キーで notes パネルを再レンダリング
  // (移調ロジックは MoonBit 側の parse_to_notes_html を呼ぶ — 二重実装しない)
  document.addEventListener("change", (ev) => {
    const select = ev.target as HTMLSelectElement | null;
    if (!select?.classList?.contains("chord-key-select")) return;
    const widget = select.closest(".chord-widget") as HTMLElement | null;
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
  });
}
