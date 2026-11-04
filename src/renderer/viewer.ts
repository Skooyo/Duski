import DOMPurify from 'dompurify';

const stage = document.getElementById('stage') as HTMLElement;
const content = document.getElementById('content') as HTMLElement;

let w = 0; // natural diagram size in px
let h = 0;
let scale = 1;
let x = 0;
let y = 0;
let drag: { px: number; py: number; x: number; y: number } | null = null;

window.duski.on('viewer:show', (svg: string) => {
  content.innerHTML = DOMPurify.sanitize(svg);
  const el = content.querySelector('svg');
  if (!el) return;
  const vb = el.viewBox.baseVal;
  const box = el.getBoundingClientRect();
  w = vb?.width || box.width || 800;
  h = vb?.height || box.height || 600;
  // Mermaid sets width="100%" and a max-width; draw at the natural size and zoom with a transform instead.
  el.setAttribute('width', String(w));
  el.setAttribute('height', String(h));
  el.style.maxWidth = 'none';
  reset();
});
window.duski.send('viewer:ready');

function apply(): void {
  content.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}

/** Fit the whole diagram in the window, centered. */
function reset(): void {
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  scale = Math.min(sw / w, sh / h) * 0.92;
  x = (sw - w * scale) / 2;
  y = (sh - h * scale) / 2;
  apply();
}

stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  const next = Math.min(Math.max(scale * Math.exp(-e.deltaY * 0.0015), 0.05), 40);
  // Keep the point under the cursor in place.
  x = px - ((px - x) * next) / scale;
  y = py - ((py - y) * next) / scale;
  scale = next;
  apply();
}, { passive: false });

stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  drag = { px: e.clientX, py: e.clientY, x, y };
  stage.setPointerCapture(e.pointerId);
  stage.classList.add('dragging');
});
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  x = drag.x + e.clientX - drag.px;
  y = drag.y + e.clientY - drag.py;
  apply();
});
const stopDrag = () => {
  drag = null;
  stage.classList.remove('dragging');
};
stage.addEventListener('pointerup', stopDrag);
stage.addEventListener('pointercancel', stopDrag);
stage.addEventListener('dblclick', reset);
addEventListener('resize', reset);
addEventListener('keydown', (e) => e.key === 'Escape' && window.duski.send('viewer:close'));
document.getElementById('min')!.addEventListener('click', () => window.duski.send('viewer:minimize'));
document.getElementById('close')!.addEventListener('click', () => window.duski.send('viewer:close'));
