type Item = { id: string; label: string; icon: string };

const SVG_NS = 'http://www.w3.org/2000/svg';
const R0 = 44; // inner radius
const GAP = 3; // px between slices, the same width from hub to rim
const svg = document.getElementById('pie') as unknown as SVGSVGElement;

window.duski.on('pie:show', ({ x, y, items }: { x: number; y: number; items: Item[] }) => {
  // More slices are narrower: grow the ring so a label like "Translate area" still fits between the dividers.
  const R1 = items.length <= 4 ? 140 : items.length <= 6 ? 160 : 185;
  const cx = Math.min(Math.max(x, R1 + 8), innerWidth - R1 - 8);
  const cy = Math.min(Math.max(y, R1 + 8), innerHeight - R1 - 8);
  const wheel = el('g', { class: 'wheel' });
  wheel.style.transformOrigin = `${cx}px ${cy}px`;
  const step = (2 * Math.PI) / items.length;
  items.forEach((item, i) => {
    const mid = -Math.PI / 2 + i * step; // slice 1 at the top, then clockwise
    const g = el('g', { class: 'slice', role: 'menuitem', 'aria-label': item.label });
    g.append(el('path', { d: sector(cx, cy, R1, mid - step / 2, mid + step / 2) }));
    const rm = R0 + (R1 - R0) * 0.55; // a bit outward: the slice is wider there
    const tx = cx + rm * Math.cos(mid);
    const ty = cy + rm * Math.sin(mid);
    // Icon and label as one block centered on (tx, ty). The number is its own tspan: SVG merges repeated spaces.
    const label = text(tx, ty + 13, '', 'label');
    label.append(el('tspan', { class: 'num' }), el('tspan', { dx: 5 }));
    label.firstChild!.textContent = String(i + 1);
    label.lastChild!.textContent = item.label;
    g.append(text(tx, ty - 11, item.icon, 'icon'), label);
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

/**
 * Annular sector for the slice a0..a1 (radians), inset by GAP/2 on each side. The inset is an angle per radius
 * (GAP / 2 / r), so the gap has parallel sides; a fixed angle would make it a wedge, wide at the rim and 0 at the hub.
 * The inset also keeps the arc below 2π, so a single slice still draws.
 */
function sector(cx: number, cy: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  const o1 = GAP / 2 / r1;
  const o0 = GAP / 2 / R0;
  const large = a1 - a0 - 2 * o1 > Math.PI ? 1 : 0;
  return `M ${p(r1, a0 + o1)} A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1 - o1)} L ${p(R0, a1 - o0)} A ${R0} ${R0} 0 ${large} 0 ${p(R0, a0 + o0)} Z`;
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
