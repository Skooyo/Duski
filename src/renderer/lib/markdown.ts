import DOMPurify from 'dompurify';
import { Marked } from 'marked';

/** Markdown for Ask and Chat replies: ```mermaid and ```svg blocks become diagrams. A click opens the viewer. */

type Diagram = { lang: 'mermaid' | 'svg'; src: string; svg?: string; error?: string; started?: boolean };

const diagrams: Diagram[] = [];
const ids = new Map<string, number>(); // lang + source -> index in diagrams, so a re-render reuses the result
let listener = () => {};
let mermaid: Promise<any> | null = null;
let queue = Promise.resolve(); // mermaid.render is not safe to run in parallel

const md = new Marked({
  renderer: {
    code({ lang, text, raw }) {
      const kind = lang?.trim().toLowerCase();
      if (kind !== 'mermaid' && kind !== 'svg') return false;
      // An unclosed fence is still streaming: its source is not complete yet.
      if (!/(^|\n) {0,3}(`{3,}|~{3,})[ \t]*\n*$/.test(raw.slice(3))) return '<figure class="diagram pending">Drawing diagram…</figure>';
      const key = `${kind}\n${text}`;
      let id = ids.get(key);
      if (id === undefined) {
        id = diagrams.push({ lang: kind, src: text }) - 1;
        ids.set(key, id);
      }
      return `<figure class="diagram" data-diagram="${id}"></figure>`;
    },
  },
});

/** Called after a diagram finishes (it can change the height of the reply). */
export function onDiagramChange(fn: () => void): void {
  listener = fn;
}

export function renderMarkdown(el: HTMLElement, raw: string, breaks = false): void {
  // Claude output can contain HTML; sanitize before it touches the DOM.
  el.innerHTML = DOMPurify.sanitize(md.parse(raw, { async: false, breaks }) as string);
  for (const fig of el.querySelectorAll<HTMLElement>('figure[data-diagram]')) {
    const d = diagrams[Number(fig.dataset.diagram)];
    if (d.lang === 'svg' && !d.started) prepareSvg(d);
    if (d.lang === 'mermaid' && !d.started) void renderMermaid(d, Number(fig.dataset.diagram));
    fill(fig, d);
  }
}

function fill(fig: HTMLElement, d: Diagram): void {
  fig.classList.toggle('pending', !d.svg && !d.error);
  fig.classList.toggle('failed', !!d.error);
  if (d.svg) {
    fig.innerHTML = d.svg;
    fig.tabIndex = 0;
    fig.role = 'button';
    fig.title = 'Click to enlarge';
    fig.ariaLabel = 'Diagram. Press Enter to enlarge.';
  } else if (d.error) {
    const source = document.createElement('details');
    const summary = document.createElement('summary');
    const pre = document.createElement('pre');
    summary.textContent = 'Show source';
    pre.textContent = d.src;
    source.append(summary, pre);
    const note = Object.assign(document.createElement('p'), { className: 'note', textContent: 'Diagram could not render.' });
    note.title = d.error;
    fig.replaceChildren(note, source);
  } else {
    fig.textContent = 'Drawing diagram…';
  }
}

function prepareSvg(d: Diagram): void {
  d.started = true;
  const t = document.createElement('template');
  t.innerHTML = DOMPurify.sanitize(d.src);
  const svg = t.content.querySelector('svg');
  if (!svg) return void (d.error = 'No <svg> element');
  // Without a viewBox the SVG cannot scale to the window width.
  const w = parseFloat(svg.getAttribute('width') ?? '');
  const h = parseFloat(svg.getAttribute('height') ?? '');
  if (!svg.hasAttribute('viewBox') && w > 0 && h > 0) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  d.svg = svg.outerHTML;
}

async function renderMermaid(d: Diagram, id: number): Promise<void> {
  d.started = true;
  const job = queue.then(async () => {
    const m = await loadMermaid();
    const { svg } = await m.render(`duski-mmd-${id}`, d.src);
    d.svg = DOMPurify.sanitize(svg);
  });
  queue = job.catch(() => {});
  try {
    await job;
  } catch (err) {
    d.error = err instanceof Error ? err.message : String(err);
    document.getElementById(`dduski-mmd-${id}`)?.remove(); // mermaid can leave its scratch element behind on an error
  }
  for (const fig of document.querySelectorAll<HTMLElement>(`figure[data-diagram="${id}"]`)) fill(fig, d);
  listener();
}

function loadMermaid(): Promise<any> {
  mermaid ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '../dist/renderer/mermaid.min.js';
    s.onload = () => {
      const m = (globalThis as any).mermaid;
      const dark = matchMedia('(prefers-color-scheme: dark)').matches;
      // htmlLabels off: labels become SVG text, so DOMPurify keeps them and the viewer scales them.
      m.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: dark ? 'redux-dark-color' : 'redux-color', look: 'neo', htmlLabels: false, flowchart: { htmlLabels: false }, fontFamily: 'Segoe UI, sans-serif' });
      resolve(m);
    };
    s.onerror = () => reject(new Error('Mermaid did not load'));
    document.head.append(s);
  });
  return mermaid;
}

function enlarge(fig: HTMLElement): void {
  const d = diagrams[Number(fig.dataset.diagram)];
  if (d?.svg) window.duski.send('viewer:open', d.svg);
}

document.addEventListener('click', (e) => {
  const fig = (e.target as Element).closest?.<HTMLElement>('figure[data-diagram]');
  if (fig) enlarge(fig);
});
document.addEventListener('keydown', (e) => {
  const fig = (e.target as Element).closest?.<HTMLElement>('figure[data-diagram]');
  if (fig && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    enlarge(fig);
  }
});
