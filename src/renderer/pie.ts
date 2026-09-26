type Item = { id: string; label: string; icon: string };

const SVG_NS = 'http://www.w3.org/2000/svg';
const R0 = 44; // inner radius
const R1 = 140; // outer radius
const svg = document.getElementById('pie') as unknown as SVGSVGElement;

window.duski.on('pie:show', ({ x, y, items }: { x: number; y: number; items: Item[] }) => {
  const cx = Math.min(Math.max(x, R1 + 8), innerWidth - R1 - 8);
  const cy = Math.min(Math.max(y, R1 + 8), innerHeight - R1 - 8);
  const wheel = el('g', { class: 'wheel' });
  wheel.style.transformOrigin = `${cx}px ${cy}px`;
  const step = (2 * Math.PI) / items.length;
  items.forEach((item, i) => {
    const mid = -Math.PI / 2 + i * step; // slice 1 at the top, then clockwise
    const g = el('g', { class: 'slice', role: 'menuitem', 'aria-label': item.label });
    g.append(el('path', { d: sector(cx, cy, mid - step / 2 + 0.02, mid + step / 2 - 0.02) }));
    const rm = (R0 + R1) / 2;
    const tx = cx + rm * Math.cos(mid);
    const ty = cy + rm * Math.sin(mid);
    g.append(text(tx, ty - 10, item.icon, 'icon'), text(tx, ty + 16, `${i + 1}  ${item.label}`, 'label'));
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      window.duski.send('pie:pick', item.id);
    });
    wheel.append(g);
  });
  wheel.append(el('circle', { cx, cy, r: R0 - 6, class: 'hub' }));
  svg.replaceChildren(wheel);
  document.body.classList.add('open');
});

window.duski.on('pie:clear', () => {
  svg.replaceChildren();
  document.body.classList.remove('open');
});

document.addEventListener('click', () => window.duski.send('pie:close'));
document.addEventListener('contextmenu', () => window.duski.send('pie:close'));

/** Annular sector between angles a0..a1 (radians). The 0.02 gap keeps a1 - a0 below 2π, so one slice still draws. */
function sector(cx: number, cy: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p(R1, a0)} A ${R1} ${R1} 0 ${large} 1 ${p(R1, a1)} L ${p(R0, a1)} A ${R0} ${R0} 0 ${large} 0 ${p(R0, a0)} Z`;
}

function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function text(x: number, y: number, content: string, cls: string): SVGElement {
  const t = el('text', { x, y, class: cls, 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
  t.textContent = content;
  return t;
}
