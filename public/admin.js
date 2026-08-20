'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2000);
}

async function api(path, options) {
  const res = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'error');
  return data;
}

async function load() {
  const { restaurants } = await api('/api/admin/restaurants');
  $('list').innerHTML = restaurants.map((r) => `
    <div class="r">
      <div style="font-size:26px">${esc(r.emoji)}</div>
      <div>
        <div style="font-weight:700">${esc(r.name)}</div>
        <div class="r-sub">${esc(r.cuisine)}${r.slots.map((s) => `<span class="tag">${s}</span>`).join('')}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="ghost" data-edit="${r.id}">Editar</button>
        <button class="ghost danger" data-del="${r.id}">Borrar</button>
      </div>
    </div>`).join('');
  window.__places = restaurants;
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const slots = [];
  if ($('slotLunch').checked) slots.push('lunch');
  if ($('slotSnack').checked) slots.push('snack');
  try {
    await api('/api/admin/restaurant', {
      method: 'POST',
      body: JSON.stringify({
        id: $('rid').value || undefined,
        name: $('rname').value,
        cuisine: $('cuisine').value,
        emoji: $('emoji').value || '🍴',
        slots,
      }),
    });
    toast('Guardado');
    $('cancel').click();
    load();
  } catch (err) { toast(err.message); }
});

$('cancel').addEventListener('click', () => {
  $('form').reset();
  $('rid').value = '';
  $('slotLunch').checked = true;
  $('cancel').hidden = true;
});

$('list').addEventListener('click', async (e) => {
  const edit = e.target.dataset.edit;
  const del = e.target.dataset.del;
  if (edit) {
    const r = window.__places.find((x) => x.id === edit);
    $('rid').value = r.id;
    $('rname').value = r.name;
    $('cuisine').value = r.cuisine;
    $('emoji').value = r.emoji;
    $('slotLunch').checked = r.slots.includes('lunch');
    $('slotSnack').checked = r.slots.includes('snack');
    $('cancel').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (del) {
    const r = window.__places.find((x) => x.id === del);
    if (!confirm(`Borrar ${r.name}? Se van también sus votos de hoy; las reseñas quedan guardadas.`)) return;
    await api('/api/admin/restaurant', { method: 'DELETE', body: JSON.stringify({ id: del }) });
    toast('Borrado');
    load();
  }
});

$('reset').addEventListener('click', async () => {
  if (!confirm('Borrar los votos de hoy de todos?')) return;
  const r = await api('/api/admin/reset', { method: 'POST' });
  toast(`Se borraron ${r.cleared} voto(s)`);
});

load();
