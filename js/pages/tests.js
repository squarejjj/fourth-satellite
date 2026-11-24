// The self-test page: runs tests/checks.js in the browser and lists the results.
import { runAll } from '../../tests/checks.js';
import { mountSite } from '../ui/site.js';

mountSite('tests');

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function run() {
  const out = document.getElementById('results');
  const sum = document.getElementById('summary');
  sum.textContent = 'Running…';
  sum.className = 'badge';
  out.innerHTML = '';
  setTimeout(() => {
    const t0 = performance.now();
    const results = runAll();
    const ms = performance.now() - t0;
    let group = '', html = '';
    for (const r of results) {
      if (r.group !== group) {
        group = r.group;
        html += `<div style="padding:12px 14px;background:var(--surface-2);border-bottom:1px solid var(--line);font:650 14px var(--display)">${esc(group)}</div>`;
      }
      html += `<div class="test-row"><div class="res ${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</div><div><div class="name">${esc(r.name)}</div>
        <div class="det">got: ${esc(r.got)}${r.pass ? '' : `<br>expected: ${esc(r.expected)}`}</div></div></div>`;
    }
    out.innerHTML = html;
    const passed = results.filter((r) => r.pass).length;
    sum.textContent = `${passed} of ${results.length} passed in ${Math.round(ms)} ms`;
    sum.className = `badge ${passed === results.length ? 'good' : 'bad'}`;
  }, 30);
}
document.getElementById('rerun').addEventListener('click', run);
run();
