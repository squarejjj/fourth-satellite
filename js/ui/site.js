// Shared header, footer, lab list and theme switch for every page.
import { themeChanged } from './theme.js';

export const REPO = 'https://github.com/squarejjj/fourth-satellite';
const ROOT = new URL('../../', import.meta.url); // the site root, wherever it is hosted
export const href = (path) => new URL(path, ROOT).href;

export const LABS = [
  { slug: 'timing', short: 'Timing', title: 'Timing a signal', blurb: 'The signal arrives weaker than the noise around it. Slide a copy of its code until it clicks into place.' },
  { slug: 'geometry', short: 'Geometry', title: 'Where the satellites are', blurb: 'Drag satellites around the sky and watch the error grow, shrink and stretch. Height is worst, because of the clock.' },
  { slug: 'errors', short: 'Error budget', title: 'The error budget', blurb: 'Switch the error sources on and off. The biggest one by far is the one the fourth satellite removes.' },
  { slug: 'ionosphere', short: 'Ionosphere', title: 'The ionosphere', blurb: 'Charged gas delays the signal, more by day. If it delays every satellite equally, your phone doesn’t mind.' },
  { slug: 'city', short: 'City', title: 'Lost in the city', blurb: 'Glass walls bounce signals. An echo is always late, so the phone thinks the satellite is farther away.' },
  { slug: 'smoothing', short: 'Smoothing', title: 'Smoothing the jumps', blurb: 'Your phone doesn’t believe every fix. Predict, correct, repeat: a Kalman filter on a walk.' },
  { slug: 'relativity', short: 'Relativity', title: 'Clocks in orbit', blurb: 'Satellite clocks gain 38 microseconds a day. Where that comes from, and what it would really do to you.' },
  { slug: 'spoofing', short: 'Spoofing', title: 'Faking the signal', blurb: 'Jam it and the phone knows it’s lost. Spoof it and the phone is confidently wrong. Can it tell?' },
  { slug: 'solvers', short: 'Solvers', title: 'Under the hood', blurb: 'Watch the solver guess, check and correct from the centre of the Earth, and meet the ghost answer.' },
];

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="6.5" fill="var(--earth-1)"/><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.2 2.6" opacity=".55"/><circle cx="16" cy="3" r="2.6" fill="var(--s1)"/><circle cx="27.3" cy="9.5" r="2.6" fill="var(--s2)"/><circle cx="4.7" cy="9.5" r="2.6" fill="var(--s3)"/><circle cx="16" cy="29" r="3" fill="var(--accent)"/></svg>`;

function header(active) {
  const labs = LABS.map((l, i) => `<a href="${href(`labs/${l.slug}.html`)}"${active === l.slug ? ' aria-current="page"' : ''}><i>${i + 1}</i><b>${l.title}</b><span>${l.blurb}</span></a>`).join('');
  return `<div class="in">
    <a class="brand" href="${href('index.html')}">${LOGO}<span>The Fourth Satellite</span></a>
    <nav class="nav" aria-label="Site">
      <a href="${href('index.html')}"${active === 'home' ? ' aria-current="page"' : ''}>The idea</a>
      <a class="hide-sm" href="${href('index.html#three-d')}">3D model</a>
      <div class="labs-menu"><button type="button" aria-expanded="false" aria-haspopup="true">Labs ▾</button><div class="panel" role="menu">${labs}</div></div>
      <a class="hide-sm" href="${href('tests.html')}"${active === 'tests' ? ' aria-current="page"' : ''}>Self-test</a>
      <a class="hide-sm" href="${REPO}">Code</a>
      <button class="theme-btn" type="button" title="Switch light / dark" aria-label="Switch light or dark theme">◐</button>
    </nav>
  </div>`;
}

function footer() {
  return `<div class="in">
    <div>
      <h4>The Fourth Satellite</h4>
      <p>A working GPS receiver that runs in your browser, made to show one thing: your phone finds <i>where</i> it is by working out <i>when</i> it is. Every number and picture on these pages is computed by our own JavaScript from what you set. Nothing is pre-recorded.</p>
      <p class="small">Simplified on purpose: a spherical Earth, satellites placed by direction, and errors chosen from published typical values. Each lab says what is simplified. Code under the MIT licence.</p>
    </div>
    <div><h4>Labs</h4><ul>${LABS.map((l, i) => `<li><a href="${href(`labs/${l.slug}.html`)}">${i + 1}. ${l.title}</a></li>`).join('')}</ul></div>
    <div><h4>Check our work</h4><ul>
      <li><a href="${href('tests.html')}">Self-test: every number we compute, checked</a></li>
      <li><a href="${REPO}">Source code on GitHub</a></li>
      <li><a href="${REPO}#readme">How it works, what we simplified, sources</a></li>
    </ul></div>
  </div>`;
}

export function mountSite(active) {
  const h = document.createElement('header');
  h.className = 'site-header';
  h.innerHTML = header(active);
  document.body.prepend(h);
  // On lab pages: a strip of tabs, so every lab is one click away.
  const i = LABS.findIndex((l) => l.slug === active);
  if (i >= 0) {
    const bar = document.createElement('nav');
    bar.className = 'lab-tabs';
    bar.setAttribute('aria-label', 'Labs');
    bar.innerHTML = `<div class="in"><a href="${href('index.html')}" class="home">← The idea</a>${LABS.map((l, k) => `<a href="${href(`labs/${l.slug}.html`)}"${k === i ? ' aria-current="page"' : ''}><i>${k + 1}</i>${l.short}</a>`).join('')}</div>`;
    h.after(bar);
    requestAnimationFrame(() => { const cur = bar.querySelector('[aria-current]'); if (cur) bar.querySelector('.in').scrollLeft = cur.offsetLeft - 80; });
  }
  const f = document.createElement('footer');
  f.className = 'site-footer';
  f.innerHTML = footer();
  document.body.append(f);

  const menu = h.querySelector('.labs-menu');
  const btn = menu.querySelector('button');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.classList.toggle('open');
    btn.setAttribute('aria-expanded', open);
  });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.classList.remove('open'); });

  // Theme: auto → light → dark. Remembered per browser when storage is available.
  const root = document.documentElement;
  try { const t = localStorage.getItem('theme'); if (t) root.dataset.theme = t; } catch { /* storage unavailable */ }
  h.querySelector('.theme-btn').addEventListener('click', () => {
    const cur = root.dataset.theme;
    const next = !cur ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark') : cur === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* ignore */ }
    themeChanged();
  });
}

// Previous / next links at the bottom of each lab.
export function labNav(slug) {
  const i = LABS.findIndex((l) => l.slug === slug);
  const prev = i > 0 ? LABS[i - 1] : null;
  const next = i < LABS.length - 1 ? LABS[i + 1] : null;
  const prevHtml = prev ? `<a href="${href(`labs/${prev.slug}.html`)}"><small>← Lab ${i}</small><b>${prev.title}</b></a>` : `<a href="${href('index.html')}"><small>← Start</small><b>The fourth satellite</b></a>`;
  const nextHtml = next ? `<a class="next" href="${href(`labs/${next.slug}.html`)}"><small>Lab ${i + 2} →</small><b>${next.title}</b></a>` : `<a class="next" href="${href('tests.html')}"><small>Finally →</small><b>Check every number</b></a>`;
  return `<nav class="lab-nav" aria-label="Labs">${prevHtml}${nextHtml}</nav>`;
}

// Tiny DOM helper.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

// Keep a range input's filled track in step with its value.
export function paintRange(input) {
  const f = () => {
    const p = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty('--fill', `${p}%`);
  };
  input.addEventListener('input', f);
  f();
  return f;
}
