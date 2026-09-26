const shot = document.getElementById('shot') as HTMLImageElement;
const box = document.getElementById('box') as HTMLDivElement;
let start: { x: number; y: number } | null = null;
let rect = { x: 0, y: 0, width: 0, height: 0 };

window.duski.on('region:init', async (dataUrl: string) => {
  shot.src = dataUrl;
  await shot.decode().catch(() => {});
  // Two frames: the first commits the image, the second guarantees it is on screen before main shows the window.
  requestAnimationFrame(() => requestAnimationFrame(() => window.duski.send('region:ready')));
});

addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  start = { x: e.clientX, y: e.clientY };
  box.hidden = false;
  document.body.classList.add('dragging');
  update(e);
});
addEventListener('mousemove', (e) => update(e));
addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !start) return;
  update(e);
  start = null;
  window.duski.send('region:done', rect);
});
addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.duski.send('region:done', null);
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.duski.send('region:done', null);
});

function update(e: MouseEvent): void {
  if (!start) return;
  rect = {
    x: Math.min(start.x, e.clientX),
    y: Math.min(start.y, e.clientY),
    width: Math.abs(e.clientX - start.x),
    height: Math.abs(e.clientY - start.y),
  };
  Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
}
