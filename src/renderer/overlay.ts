// Paints translated blocks over the original text of a screen area, like Google Lens.
// Colors come from the screenshot itself: the background from the pixels around the box, the text from the
// pixels inside it that differ most from that background.

type Block = { box: [number, number, number, number]; text: string };
type RGB = [number, number, number];

const PAD = 3; // image px around Claude's box, so a box that is a little off still covers the original
let ctx: CanvasRenderingContext2D | null = null;
let scale = 1; // CSS px per image px
const queue: Block[] = [];

window.duski.on('overlay:init', async ({ image, width }: { image: string; width: number }) => {
  const img = new Image();
  img.src = image;
  await img.decode();
  const canvas = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
  ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  scale = innerWidth / width;
  for (const b of queue.splice(0)) draw(b);
});
window.duski.on('overlay:block', (b: Block) => (ctx ? draw(b) : queue.push(b)));
window.duski.on('overlay:visible', (on: boolean) => document.body.classList.toggle('off', !on));

function draw({ box, text }: Block): void {
  const W = ctx!.canvas.width;
  const H = ctx!.canvas.height;
  const l = clamp(Math.round(box[0]) - PAD, 0, W - 1);
  const t = clamp(Math.round(box[1]) - PAD, 0, H - 1);
  const r = clamp(Math.round(box[2]) + PAD, l + 1, W);
  const b = clamp(Math.round(box[3]) + PAD, t + 1, H);
  // Left and right halves of the frame separately: the patch then follows a horizontal gradient in the background.
  const mid = Math.round((l + r) / 2);
  const bgL = borderMedian(l, t, mid, b);
  const bgR = borderMedian(mid, t, r, b);
  const bg: RGB = [(bgL[0] + bgR[0]) / 2, (bgL[1] + bgR[1]) / 2, (bgL[2] + bgR[2]) / 2];
  const fg = ink(l, t, r, b, bg);

  const el = document.createElement('div');
  el.className = 'block';
  el.textContent = text;
  Object.assign(el.style, {
    left: `${l * scale}px`,
    top: `${t * scale}px`,
    width: `${(r - l) * scale}px`,
    height: `${(b - t) * scale}px`,
    background: `linear-gradient(to right, ${css(bgL)}, ${css(bgR)})`,
    color: css(fg),
    boxShadow: `0 0 ${4 * scale}px ${2 * scale}px ${css(bg)}`, // soft edge instead of a hard patch
  });
  document.body.append(el);
  fit(el);
}

/** Largest font size (up to 80% of the box height) at which the text fits the box. */
function fit(el: HTMLElement): void {
  let size = Math.min(el.clientHeight * 0.8, 72);
  el.style.fontSize = `${size}px`;
  while (size > 7 && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
    size *= 0.92;
    el.style.fontSize = `${size}px`;
  }
}

/** Median color of the 1 px frame around the box (l..r, t..b): the background the text sits on. */
function borderMedian(l: number, t: number, r: number, b: number): RGB {
  const px: RGB[] = [];
  const add = (x: number, y: number, w: number, h: number) => {
    if (w < 1 || h < 1) return;
    const d = ctx!.getImageData(x, y, w, h).data;
    for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
  };
  add(l, t, r - l, 1);
  add(l, b - 1, r - l, 1);
  add(l, t, 1, b - t);
  add(r - 1, t, 1, b - t);
  const mid = (c: number) => px.map((p) => p[c]).sort((a, z) => a - z)[px.length >> 1];
  return [mid(0), mid(1), mid(2)];
}

/** Average of the pixels inside the box that differ most from the background: the original text color. */
function ink(l: number, t: number, r: number, b: number, bg: RGB): RGB {
  const d = ctx!.getImageData(l, t, r - l, b - t).data;
  let max = 0;
  const dist: number[] = [];
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]);
    dist.push(v);
    max = Math.max(max, v);
  }
  const sum = [0, 0, 0];
  let n = 0;
  dist.forEach((v, j) => {
    if (v < max * 0.6) return;
    sum[0] += d[j * 4];
    sum[1] += d[j * 4 + 1];
    sum[2] += d[j * 4 + 2];
    n++;
  });
  const fg: RGB = n ? [sum[0] / n, sum[1] / n, sum[2] / n] : bg;
  // Too close to the background to read: fall back to black or white.
  if (Math.hypot(fg[0] - bg[0], fg[1] - bg[1], fg[2] - bg[2]) < 80) return luma(bg) > 140 ? [20, 20, 20] : [245, 245, 245];
  return fg;
}

const luma = ([r, g, b]: RGB) => 0.299 * r + 0.587 * g + 0.114 * b;
const css = ([r, g, b]: RGB) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
