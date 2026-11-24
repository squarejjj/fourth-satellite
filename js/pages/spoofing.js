// Lab 8: jamming and spoofing, and two simple checks a phone can make.
import { makeSky, enuToEcef, ecefToEnu } from '../core/geo.js';
import { measure } from '../core/world.js';
import { solveFix } from '../core/receiver.js';
import { add, sub } from '../core/linalg.js';
import { gaussianSource } from '../core/rng.js';
import { createStage, label, tag } from '../ui/canvas.js';
import { palette, onThemeChange, alpha } from '../ui/theme.js';
import { lineChart } from '../ui/chart.js';
import * as F from '../ui/format.js';
import { mountSite, labNav, paintRange } from '../ui/site.js';

mountSite('spoofing');
document.getElementById('labnav').innerHTML = labNav('spoofing');

const SKY = [[10, 72], [60, 25], [115, 48], [170, 18], [215, 55], [260, 12], [300, 35], [345, 20]].map(([az, el], i) => ({ id: i + 1, az, el }));
const sky = makeSky({ lat: 37.5, lon: 127 }, SKY);
const T = 90, START = 20, SPEED = 15, NOISE = 2;
const S = { attack: 'spoof', strength: 4, some: false, raim: true, motion: true, thresh: 25, time: 90 };
let run = null;

const at = (en) => add(sky.user, enuToEcef([en[0], en[1], 0], sky.basis));

function simulate() {
  const g = gaussianSource(31);
  const steps = [];
  for (let t = 0; t <= T; t++) {
    const truth = [SPEED * t, 0];
    const dr = [SPEED * 1.01 * t * Math.cos(Math.PI / 180), SPEED * 1.01 * t * Math.sin(Math.PI / 180)]; // wheels + compass
    const active = t >= START && S.attack !== 'none';
    let real = sky.sats, fake = [], fakePos = truth, lost = 0;
    const noise = {};
    for (const s of SKY) noise[s.id] = NOISE * g();
    if (active && S.attack === 'jam') {
      const J = S.strength * 3 * Math.min(1, (t - START) / 10);          // jammer power, dB, ramping up
      real = sky.sats.filter((s) => {
        const cn0 = 45 - 8 * (1 - Math.sin((s.el * Math.PI) / 180)) - J;   // signal-to-noise density, dB-Hz
        if (cn0 < 30) { lost++; return false; }
        noise[s.id] *= 10 ** ((45 - cn0) / 20);
        return true;
      });
    }
    if (active && S.attack === 'spoof') {
      fakePos = [truth[0], S.strength * (t - START)];                       // dragged north at `strength` m/s
      fake = S.some ? sky.sats.slice(0, 4) : sky.sats;
      real = S.some ? sky.sats.slice(4) : [];
    }
    const meas = [
      ...measure({ truePos: at(truth), clockError: 1e-4, sats: real, extra: noise }),
      ...measure({ truePos: at(fakePos), clockError: 1e-4, sats: fake, extra: noise }),
    ];
    const fix = meas.length >= 4 ? solveFix(meas) : null;
    let en = null, status = 'none', why = '';
    if (fix && fix.ok) {
      const e = ecefToEnu(sub(fix.pos, sky.user), sky.basis);
      en = [e[0], e[1]];
      status = 'ok';
      const red = fix.have - fix.nUnknowns;
      const rms = red > 0 ? Math.sqrt(fix.residuals.reduce((a, r) => a + r.r * r.r, 0) / red) : 0;
      if (S.raim && red > 0 && rms > 3 * NOISE) { status = 'warn'; why = 'the satellites disagree'; }
      else if (S.motion && Math.hypot(en[0] - dr[0], en[1] - dr[1]) > S.thresh) { status = 'warn'; why = 'it doesn’t match the wheels'; }
    } else why = `${meas.length} satellites heard`;
    steps.push({ t, truth, dr, en, status, why, err: en ? Math.hypot(en[0] - truth[0], en[1] - truth[1]) : NaN, lost, n: meas.length });
  }
  const first = steps.find((s) => s.t >= START && s.status !== 'ok');
  run = { steps, first };
}

const STATUS = { ok: ['Position available', 'good'], warn: ['Position suspicious', 'accent'], none: ['No fresh position', 'bad'] };

const road = createStage(document.getElementById('road'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const st = run.steps;
    let maxN = 60;
    for (const s of st) if (s.en) maxN = Math.max(maxN, s.en[1] + 30);
    let minN = -60;
    for (const s of st) if (s.en) minN = Math.min(minN, s.en[1] - 30);
    const minE = -60, maxE = SPEED * T + 60;
    const k = Math.min((w - 40) / (maxE - minE), (h - 50) / (maxN - minN));
    const ox = 20 - minE * k, oy = 30 + maxN * k;
    const X = (e) => ox + e * k, Y = (n) => oy - n * k;
    ctx.fillStyle = alpha(P.ink2, 0.12);
    ctx.fillRect(X(minE), Y(0) - 7, (maxE - minE) * k, 14);
    ctx.strokeStyle = alpha(P.ink2, 0.35); ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.moveTo(X(minE), Y(0)); ctx.lineTo(X(maxE), Y(0)); ctx.stroke(); ctx.setLineDash([]);
    label(ctx, 'road →', X(minE) + 4, Y(0) - 16, { color: P.muted, font: '600 11px Inter, sans-serif' });
    // wheels-and-compass estimate
    ctx.strokeStyle = P.s3; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    ctx.beginPath();
    st.slice(0, S.time + 1).forEach((s, i) => (i ? ctx.lineTo(X(s.dr[0]), Y(s.dr[1])) : ctx.moveTo(X(s.dr[0]), Y(s.dr[1]))));
    ctx.stroke(); ctx.setLineDash([]);
    // GPS fixes coloured by what the phone reported
    for (const s of st.slice(0, S.time + 1)) {
      if (!s.en) continue;
      ctx.fillStyle = s.status === 'ok' ? P.s1 : P.accent;
      ctx.beginPath(); ctx.arc(X(s.en[0]), Y(s.en[1]), 3, 0, Math.PI * 2); ctx.fill();
    }
    const cur = st[S.time];
    ctx.fillStyle = P.true;
    ctx.fillRect(X(cur.truth[0]) - 9, Y(0) - 5, 18, 10);
    label(ctx, 'car', X(cur.truth[0]), Y(0) + 16, { color: P.true, font: '700 11px Inter, sans-serif', align: 'center' });
    if (cur.en) tag(ctx, `GPS ${STATUS[cur.status][0].split(' ')[1]}`, X(cur.en[0]) + 8, Y(cur.en[1]) - 12, { bg: cur.status === 'ok' ? P.s1 : P.accent, fg: '#fff' });
    tag(ctx, `t = ${S.time} s`, w - 12, 18, { bg: P.surface3, fg: P.ink, align: 'right' });
    label(ctx, 'dashed: wheels + compass', 12, h - 12, { color: P.s3, font: '600 11px Inter, sans-serif' });
  },
});

const timeline = createStage(document.getElementById('timeline'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const st = run.steps;
    const bands = [];
    for (const s of st) if (s.status !== 'ok') bands.push({ x0: s.t - 0.5, x1: s.t + 0.5, color: s.status === 'none' ? alpha(P.bad, 0.18) : alpha(P.warn, 0.2) });
    const ymax = Math.max(30, ...st.filter((s) => Number.isFinite(s.err)).map((s) => s.err)) * 1.1;
    lineChart(ctx, { x: 52, y: 22, w: w - 66, h: h - 50 }, {
      x: { min: 0, max: T, format: (v) => `${v}s`, count: 9 },
      y: { min: 0, max: ymax, format: (v) => `${F.num(v, 0)} m`, count: 3 },
      bands,
      series: [{ points: st.map((s) => [s.t, s.err]), color: P.ink, width: 2 }],
      vlines: [{ x: START, color: P.bad, dash: [3, 3], width: 1.2, label: 'attack' }, { x: S.time, color: P.accent, dash: [], width: 1.5 }],
    });
  },
});

function renderStats() {
  const cur = run.steps[S.time];
  const set = (id, v, d, cls = '') => { const el = document.getElementById(id); el.className = `stat ${cls}`; el.querySelector('.v').textContent = v; el.querySelector('.d').textContent = d; };
  set('st-status', STATUS[cur.status][0], cur.status === 'ok' ? `${cur.n} satellites used` : cur.why, STATUS[cur.status][1]);
  set('st-err', cur.en ? F.dist(cur.err) : '—', cur.en ? 'between the GPS fix and the car' : 'no fix to compare', cur.err > 20 ? 'bad' : '');
  if (S.attack === 'none') set('st-detect', 'No attack', '');
  else if (run.first) set('st-detect', `${run.first.t - START} s after it began`, run.first.status === 'none' ? 'the phone lost its fix' : `because ${run.first.why}`, 'good');
  else set('st-detect', 'Never', 'the attack went unnoticed', 'bad');
  document.getElementById('time-val').textContent = `${S.time} s`;
  document.getElementById('thresh-val').textContent = `${S.thresh} m`;
  document.getElementById('strength-val').textContent = S.attack === 'jam' ? `+${S.strength * 3} dB` : `${F.num(S.strength, 1)} m/s`;
  document.getElementById('strength-sub').textContent = S.attack === 'jam' ? 'How much the jammer raises the noise.' : S.attack === 'spoof' ? 'How fast the fake position drifts away from the road.' : 'Choose an attack first.';
  document.getElementById('ctl-some').style.display = S.attack === 'spoof' ? '' : 'none';
  document.getElementById('ctl-strength').style.opacity = S.attack === 'none' ? 0.45 : 1;
}

function update() { simulate(); renderStats(); road.redraw(); timeline.redraw(); }
document.querySelectorAll('#attack button').forEach((b) => b.addEventListener('click', () => {
  S.attack = b.dataset.a;
  document.querySelectorAll('#attack button').forEach((q) => q.setAttribute('aria-pressed', q === b));
  update();
}));
const bind = (id, key) => { const el = document.getElementById(id); paintRange(el); el.addEventListener('input', () => { S[key] = +el.value; update(); }); };
bind('strength', 'strength');
bind('thresh', 'thresh');
bind('time', 'time');
for (const id of ['some', 'raim', 'motion']) document.getElementById(id).addEventListener('change', (e) => { S[id] = e.target.checked; update(); });
onThemeChange(() => { road.redraw(); timeline.redraw(); });
update();
