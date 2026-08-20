'use strict';

const track = document.getElementById('track');
const tickerTrack = document.getElementById('tickerTrack');
const stage = document.getElementById('stage');

let state = null;
let lastCounts = {};
let renderedKey = '';
let rootPx = 16;

// -------------------------------------------------------------- responsive
/**
 * One knob for the whole board: the root font-size. On a 1920x1080 wall screen
 * it lands on 16px (the size everything was designed at) and shrinks or grows
 * from there. Narrow screens get a stacked header instead of a squeezed one.
 */
function fit() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const wide = w / h >= 1.25;
  const scale = wide
    ? Math.min(w / 1920, h / 1080)
    : Math.min(w / 1080, h / 1500);
  rootPx = Math.max(6, Math.min(scale, 2.4) * 16);
  document.documentElement.style.fontSize = rootPx + 'px';
  document.body.classList.toggle('narrow', !wide);
  document.body.classList.toggle('tiny', h < 520 || w < 560);
  sizeConfetti();
  if (state) { renderCards(); renderTicker(); } else setWidth();
}
window.addEventListener('resize', fit);

// ------------------------------------------------------------------ helpers
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Reds run dark -> light across the row, like the reference board. */
function cardColor(index, total) {
  const steps = Math.max(total, 5);
  const t = (index % steps) / (steps - 1 || 1);
  return `hsl(351 ${66 - t * 8}% ${30 + t * 34}%)`;
}

function stars(avg) {
  const full = Math.round(avg);
  return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
}

// ----------------------------------------------------------------- tarjetas
function cardEl(option, index, total, isLeader) {
  const el = document.createElement('article');
  el.className = 'card';
  el.style.background = cardColor(index, total);

  const rating = option.rating.count
    ? `<div class="card-rating"><span class="stars">${stars(option.rating.average)}</span>
       <span>${option.rating.average.toFixed(1)} · ${option.rating.count} ${option.rating.count === 1 ? 'reseña' : 'reseñas'}</span></div>`
    : `<div class="card-rating"><span class="stars">☆☆☆☆☆</span><span>sin reseñas</span></div>`;

  // Keep the chip list inside the card; the rest is summarised.
  const MAX_CHIPS = 8;
  const shown = option.voters.slice(0, MAX_CHIPS);
  const hidden = option.voters.length - shown.length;
  const voters = shown
    .map((v) => `<span class="voter">${esc(v.name)}${v.note ? ` <em>· ${esc(v.note)}</em>` : ''}</span>`)
    .join('') + (hidden > 0 ? `<span class="voter">+${hidden} más</span>` : '');

  el.innerHTML = `
    ${isLeader && option.votes > 0 ? '<div class="badge">VA GANANDO</div>' : ''}
    <div class="card-emoji">${esc(option.emoji)}</div>
    <h2 class="card-name">${esc(option.name)}</h2>
    <div class="card-cuisine">${esc(option.cuisine)}</div>
    <div class="voters">${voters}</div>
    <div class="card-count"><b data-id="${option.id}">${option.votes}</b><span>yendo</span></div>
    ${rating}`;
  return el;
}

function buildTrack(options, passes) {
  const frag = document.createDocumentFragment();
  for (let pass = 0; pass < passes; pass++) {
    options.forEach((o, i) => frag.appendChild(cardEl(o, i, options.length, i === 0)));
  }
  track.innerHTML = '';
  track.appendChild(frag);
}

/** Distance from one pass of the list to the next — the marquee's loop length. */
function passWidth(count) {
  const kids = track.children;
  if (kids.length <= count) return 0;
  return kids[count].offsetLeft - kids[0].offsetLeft;
}

function renderCards() {
  const options = state.options;
  if (!options.length) {
    track.innerHTML = '<div class="empty-card">Todavía no hay lugares cargados para este turno — sumá uno desde el celular.</div>';
    loopWidth = 0;
    return;
  }
  // Repeat the list until it covers the screen plus a full pass. With two or
  // three options a single repeat is narrower than the screen, and the marquee
  // would scroll into blank space before wrapping around.
  buildTrack(options, 2);
  const one = passWidth(options.length);
  const needed = one > 0 ? Math.max(2, Math.ceil(window.innerWidth / one) + 1) : 2;
  if (needed !== 2) buildTrack(options, needed);
  setWidth();
}

function bumpChanged() {
  for (const o of state.options) {
    if (lastCounts[o.id] !== undefined && lastCounts[o.id] !== o.votes) {
      document.querySelectorAll(`.card-count b[data-id="${o.id}"]`).forEach((n) => {
        n.classList.remove('bump');
        void n.offsetWidth;
        n.classList.add('bump');
      });
    }
    lastCounts[o.id] = o.votes;
  }
}

function renderHeader() {
  const t = state.time;
  document.getElementById('clock').textContent = t.clock + ' ART';
  const pill = document.getElementById('slotPill');
  pill.textContent = `${t.slotEmoji} ${t.slotLabel}`;
  pill.className = 'pill ' + t.phase;

  const c = t.countdown;
  const mins = c.minutes == null ? null : `${c.minutes >= 60 ? Math.floor(c.minutes / 60) + ' h ' : ''}${c.minutes % 60} min`;
  document.getElementById('countdown').textContent = mins ? `${c.label} ${mins}` : `${c.label} · ${t.window}`;

  const total = state.options.reduce((a, o) => a + o.votes, 0);
  document.getElementById('tally').textContent = total === 1 ? '1 sumado' : `${total} sumados`;
  const urlEl = document.getElementById('joinUrl');
  if (urlEl) urlEl.textContent = state.joinUrl.replace(/^https?:\/\//, '');
}

function renderTicker() {
  const items = state.feed.length
    ? state.feed.map((f) => f.type === 'vote'
        ? `<span><b>${esc(f.name)}</b> → ${esc(f.place)}${f.note ? ` <i>(${esc(f.note)})</i>` : ''}</span>`
        : `<span><b>${esc(f.name)}</b> puntuó ${esc(f.place)} <i>${'★'.repeat(f.rating)}</i>${f.text ? ` “${esc(f.text)}”` : ''}</span>`)
    : ['<span>Escaneá el QR para sumarte y decir de dónde pedís.</span>'];
  const one = items.join('');
  tickerTrack.innerHTML = one + one;
  // Same trick as the cards: with one or two entries the strip is shorter than
  // the screen, so repeat it until it isn't.
  const width = tickerPassWidth(items.length);
  if (width > 0) {
    const needed = Math.max(2, Math.ceil(window.innerWidth / width) + 1);
    if (needed !== 2) tickerTrack.innerHTML = one.repeat(needed);
  }
  tickerLoop = tickerPassWidth(items.length);
}

function tickerPassWidth(count) {
  const kids = tickerTrack.children;
  if (kids.length <= count) return 0;
  return kids[count].offsetLeft - kids[0].offsetLeft;
}

let qrRendered = '';
function renderQR() {
  const key = state.joinUrl + state.reachable;
  if (qrRendered === key) return;
  qrRendered = key;
  const box = document.getElementById('qr');
  const caption = document.getElementById('qrCaption');
  if (state.reachable === false) {
    box.innerHTML = '<div class="qr-down">!</div>';
    caption.innerHTML = '<strong>SIN RED</strong><span>La compu no tiene IP en la red, ' +
      'nadie puede escanear. Reconectá el Wi-Fi.</span>';
    return;
  }
  box.innerHTML = QR.toSVG(state.joinUrl, { ecc: 'M', quiet: 3 });
  caption.innerHTML = '<strong>ESCANEÁ<br>Y SUMATE</strong><span id="joinUrl">' +
    esc(state.joinUrl.replace(/^https?:\/\//, '')) + '</span>';
}

function render() {
  renderHeader();
  renderQR();
  renderTicker();
  // Only rebuild the cards when the board actually changed, so the marquee
  // never stutters on a clock tick.
  const key = JSON.stringify(state.options.map((o) => [o.id, o.votes, o.rating.count, o.voters.map((v) => v.name + v.note)]));
  if (key !== renderedKey) {
    renderedKey = key;
    renderCards();
  }
  bumpChanged();
}

// ------------------------------------------------------------------ marquee
let offset = 0;
let loopWidth = 0;
let tickerOffset = 0;
let tickerLoop = 0;
let lastFrame = 0;

function setWidth() {
  loopWidth = state && state.options.length ? passWidth(state.options.length) : 0;
  if (loopWidth > 0) offset = offset % loopWidth;
}

function frame(ts) {
  const dt = lastFrame ? Math.min((ts - lastFrame) / 1000, 0.1) : 0;
  lastFrame = ts;

  if (loopWidth > 0) {
    offset += 2.875 * rootPx * dt; // ~46px/s on a 1920-wide screen
    if (offset >= loopWidth) offset -= loopWidth;
    track.style.transform = `translateX(${-offset}px)`;
  }

  if (tickerLoop > 0) {
    tickerOffset += 2.125 * rootPx * dt;
    if (tickerOffset >= tickerLoop) tickerOffset -= tickerLoop;
    tickerTrack.style.transform = `translateX(${-tickerOffset}px)`;
  }

  drawConfetti(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ------------------------------------------------- "ANTO SUMA PARA KIDDO"
const shout = document.getElementById('shout');
const canvas = document.getElementById('confetti');
const ctx = canvas.getContext('2d');
let confetti = [];
let lastVoteTs = 0;
let queue = [];
let showing = false;

function sizeConfetti() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
sizeConfetti();

const COLORS = ['#d92d3f', '#9d1f2d', '#f2808f', '#111014', '#f6c945'];

function burst() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const sx = w / 1400;
  const sy = h / 900;
  for (let i = 0; i < 180; i++) {
    const fromLeft = i % 2 === 0;
    confetti.push({
      x: fromLeft ? -20 : w + 20,
      y: h * (0.6 + Math.random() * 0.4),
      vx: (fromLeft ? 1 : -1) * (620 + Math.random() * 900) * sx, // px/s
      vy: -(900 + Math.random() * 700) * sy,
      w: (7 + Math.random() * 8) * sx,
      h: (10 + Math.random() * 12) * sy,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 14,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      life: 4,
    });
  }
}

const GRAVITY = 1500; // px/s^2

function drawConfetti(dt) {
  if (!confetti.length) {
    if (canvas.dataset.dirty) {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      delete canvas.dataset.dirty;
    }
    return;
  }
  canvas.dataset.dirty = '1';
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  const g = GRAVITY * (window.innerHeight / 900);
  for (const p of confetti) {
    p.life -= dt;
    p.vy += g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  confetti = confetti.filter((p) => p.life > 0 && p.y < window.innerHeight + 80);
}

function announce(item) {
  queue.push(item);
  if (!showing) next();
}

function next() {
  const item = queue.shift();
  if (!item) { showing = false; return; }
  showing = true;
  document.getElementById('shoutText').innerHTML =
    `${esc(item.name.toUpperCase())} <i>SUMA</i> PARA<br>${esc(String(item.place || '').toUpperCase())}`;
  document.getElementById('shoutNote').textContent = item.note ? `· ${item.note} ·` : '';
  shout.hidden = false;
  shout.classList.remove('out');
  burst();
  setTimeout(() => {
    shout.classList.add('out');
    setTimeout(() => { shout.hidden = true; next(); }, 400);
  }, 3000);
}

/** Announce every vote that showed up since the last poll (skips first load). */
function checkNewVotes(first) {
  const votes = state.feed.filter((f) => f.type === 'vote');
  const newest = votes.reduce((a, v) => Math.max(a, v.ts), 0);
  if (!first) {
    votes
      .filter((v) => v.ts > lastVoteTs)
      .sort((a, b) => a.ts - b.ts)
      .slice(-2)  // never hide the board for more than a couple of shouts
      .forEach(announce);
  }
  lastVoteTs = Math.max(lastVoteTs, newest);
}

// ---------------------------------------------------------------------- data
const offlineEl = document.getElementById('offline');

// ?slot=lunch|snack pins the board to one slot instead of following the clock.
const pinnedSlot = new URLSearchParams(location.search).get('slot');
let firstLoad = true;

async function load() {
  try {
    const res = await fetch('/api/state' + (pinnedSlot ? `?slot=${encodeURIComponent(pinnedSlot)}` : ''), { cache: 'no-store' });
    state = await res.json();
    offlineEl.hidden = true;
    render();
    checkNewVotes(firstLoad);
    firstLoad = false;
  } catch {
    offlineEl.hidden = false;
  }
}

function connect() {
  const es = new EventSource('/api/stream');
  es.onmessage = load;
  es.onopen = () => { offlineEl.hidden = true; load(); };
  es.onerror = () => { offlineEl.hidden = false; };
}

// ?nostream=1 disables the live connection (useful for screenshots / kiosk debug)
const streaming = !new URLSearchParams(location.search).has('nostream');

fit();
load();
if (streaming) connect();
setInterval(load, streaming ? 20000 : 5000); // clock + slot changes even if SSE is quiet
