'use strict';

const $ = (id) => document.getElementById(id);
const NAME_KEY = 'wdwet.name';

let state = null;
let myName = localStorage.getItem(NAME_KEY) || '';
let sheetPlace = null;
let pickedStars = 0;

$('name').value = myName;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2200);
}

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Algo salió mal');
  return data;
}

// -------------------------------------------------------------------- render
function myVote() {
  if (!myName || !state) return null;
  const me = myName.trim().toLowerCase();
  for (const o of state.options) {
    const hit = o.voters.find((v) => v.name.trim().toLowerCase() === me);
    if (hit) return { option: o, note: hit.note };
  }
  return null;
}

function render() {
  const t = state.time;
  const pill = $('slotPill');
  pill.textContent = `${t.slotEmoji} ${t.slotLabel}`;
  pill.className = 'pill ' + t.phase;
  $('clock').textContent = `${t.clock} ART`;

  const c = t.countdown;
  const mins = c.minutes == null ? '' : `${Math.floor(c.minutes / 60) ? Math.floor(c.minutes / 60) + ' h ' : ''}${c.minutes % 60} min`;
  $('status').textContent = t.phase === 'open'
    ? `Se está pidiendo — ${c.label} ${mins} (${t.window}).`
    : t.phase === 'upcoming'
      ? `${t.slotLabel.toLowerCase()}: ${c.label} ${mins} (${t.window}). Podés sumarte desde ahora.`
      : `Ya cerró por hoy. El almuerzo abre mañana a las ${t.window.split('-')[0]}.`;

  const mine = myVote();
  $('list').innerHTML = state.options.map((o) => {
    const isMine = mine && mine.option.id === o.id;
    const voters = o.voters.map((v) => v.name).join(', ');
    return `
      <div class="opt ${isMine ? 'mine' : ''}">
        <div class="opt-emoji">${esc(o.emoji)}</div>
        <div class="opt-main">
          <div class="opt-name">${esc(o.name)}</div>
          <div class="opt-sub">${esc(o.cuisine)}${o.rating.count ? ` · ★ ${o.rating.average} (${o.rating.count})` : ' · sin reseñas'}</div>
          ${voters ? `<div class="opt-voters">${esc(voters)}</div>` : ''}
        </div>
        <div class="opt-right">
          <div class="count ${o.votes ? '' : 'zero'}">${o.votes}</div>
          <div class="opt-actions">
            <button class="ghost" data-reviews="${o.id}">Reseñas</button>
            <button class="vote-btn" data-vote="${o.id}">${isMine ? 'Sumado' : 'Sumo'}</button>
          </div>
        </div>
      </div>`;
  }).join('') || '<p class="muted">Todavía no hay lugares para este turno. Agregá uno acá abajo.</p>';

  $('myVote').innerHTML = mine
    ? `Vas a <b>${esc(mine.option.name)}</b>${mine.note ? ` · ${esc(mine.note)}` : ''}`
    : 'Todavía no te sumaste.';
  $('clearVote').hidden = !mine;
}

// -------------------------------------------------------------------- events
$('saveName').addEventListener('click', () => {
  myName = $('name').value.trim();
  localStorage.setItem(NAME_KEY, myName);
  toast(myName ? `Hola ${myName}` : 'Nombre borrado');
  if (state) render();
});
$('name').addEventListener('change', () => $('saveName').click());

$('list').addEventListener('click', async (e) => {
  const voteId = e.target.dataset.vote;
  const reviewsId = e.target.dataset.reviews;
  if (reviewsId) return openSheet(reviewsId);
  if (!voteId) return;

  myName = $('name').value.trim();
  if (!myName) { toast('Primero poné tu nombre'); $('name').focus(); return; }
  localStorage.setItem(NAME_KEY, myName);

  const option = state.options.find((o) => o.id === voteId);
  const mine = myVote();
  const alreadyMine = mine && mine.option.id === voteId;

  let note = '';
  if (!alreadyMine) {
    note = prompt(`Qué vas a pedir de ${option.name}? (opcional)`, '') || '';
  }

  try {
    const r = await api('/api/vote', {
      method: 'POST',
      body: JSON.stringify({ name: myName, restaurantId: voteId, slot: state.slot, note: note.trim() }),
    });
    toast(r.action === 'removed' ? 'Te bajaste' : r.action === 'moved' ? `Te pasaste a ${option.name}` : `Sumado a ${option.name}`);
    await load();
  } catch (err) {
    toast(err.message);
  }
});

$('clearVote').addEventListener('click', async () => {
  await api('/api/unvote', { method: 'POST', body: JSON.stringify({ name: myName, slot: state.slot }) });
  toast('Te bajaste');
  load();
});

// --------------------------------------------------------------- review sheet
async function openSheet(restaurantId) {
  sheetPlace = state.options.find((o) => o.id === restaurantId);
  $('sheetTitle').textContent = sheetPlace.name;
  $('sheet').hidden = false;
  pickedStars = 0;
  paintStars();
  $('reviewText').value = '';
  $('reviewList').innerHTML = '<div class="review-empty">Cargando…</div>';

  const { reviews, stats } = await api(`/api/reviews?restaurantId=${encodeURIComponent(restaurantId)}`);
  $('sheetStats').textContent = stats.count
    ? `★ ${stats.average} · ${stats.count} ${stats.count === 1 ? 'reseña' : 'reseñas'}`
    : 'Todavía no hay reseñas — escribí la primera.';
  $('reviewList').innerHTML = reviews.length
    ? reviews.map((r) => `
        <div class="review">
          <div class="review-head">
            <b>${esc(r.name)}</b>
            <span><span class="review-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span> · ${new Date(r.ts).toLocaleDateString()}</span>
          </div>
          ${r.text ? `<p>${esc(r.text)}</p>` : ''}
        </div>`).join('')
    : '<div class="review-empty">Nada por acá todavía.</div>';
}

$('closeSheet').addEventListener('click', () => { $('sheet').hidden = true; });
$('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') $('sheet').hidden = true; });

function paintStars() {
  document.querySelectorAll('#starPicker button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.v) <= pickedStars);
  });
}
$('starPicker').addEventListener('click', (e) => {
  if (!e.target.dataset.v) return;
  pickedStars = Number(e.target.dataset.v);
  paintStars();
});

$('reviewForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  myName = $('name').value.trim();
  if (!myName) { toast('Primero poné tu nombre'); return; }
  if (!pickedStars) { toast('Elegí una puntuación'); return; }
  try {
    await api('/api/review', {
      method: 'POST',
      body: JSON.stringify({
        name: myName, restaurantId: sheetPlace.id, rating: pickedStars, text: $('reviewText').value,
      }),
    });
    toast('Reseña publicada');
    openSheet(sheetPlace.id);
    load();
  } catch (err) {
    toast(err.message);
  }
});

// ------------------------------------------------------------ agregar lugar
$('toggleAdd').addEventListener('click', () => {
  const f = $('addForm');
  f.hidden = !f.hidden;
  $('toggleAdd').textContent = f.hidden ? '+ Agregar un lugar' : 'Cancelar';
  if (!f.hidden) $('newName').focus();
});

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const slots = [];
  if ($('newLunch').checked) slots.push('lunch');
  if ($('newSnack').checked) slots.push('snack');
  try {
    const { place } = await api('/api/place', {
      method: 'POST',
      body: JSON.stringify({
        name: $('newName').value,
        cuisine: $('newCuisine').value,
        emoji: $('newEmoji').value || '🍴',
        slots,
      }),
    });
    toast(`${place.name} agregado`);
    $('addForm').reset();
    $('newLunch').checked = true;
    $('toggleAdd').click();
    load();
  } catch (err) {
    toast(err.message);
  }
});

// ---------------------------------------------------------------------- data
async function load() {
  state = await api('/api/state');
  render();
}

function connect() {
  const es = new EventSource('/api/stream');
  es.onmessage = load;
}

// ?nostream=1 disables the live connection (useful for screenshots / debugging)
const streaming = !new URLSearchParams(location.search).has('nostream');

load();
if (streaming) connect();
setInterval(load, streaming ? 30000 : 5000);
