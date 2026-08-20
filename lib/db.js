'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const time = require('./time.js');

const FILE = path.join(__dirname, '..', 'data', 'db.json');

const SEED = {
  restaurants: [
    { id: 'r_endivia', name: 'Casa Endivia', cuisine: 'Ensaladas', emoji: '🥗', slots: ['lunch', 'snack'] },
    { id: 'r_kiddo', name: 'Kiddo', cuisine: 'Hamburguesas', emoji: '🍔', slots: ['lunch', 'snack'] },
    { id: 'r_ipolitina', name: 'Ipolitina', cuisine: 'Pizza y sandwiches', emoji: '🍕', slots: ['lunch', 'snack'] },
    { id: 'r_darwin', name: 'Darwin', cuisine: 'Tarta', emoji: '🥧', slots: ['lunch', 'snack'] },
    { id: 'r_aspen', name: 'Aspen', cuisine: 'Fideos', emoji: '🍝', slots: ['lunch', 'snack'] },
    { id: 'r_monpoulet', name: 'Mon Poulet', cuisine: 'Pollo', emoji: '🍗', slots: ['lunch', 'snack'] },
  ],
  votes: [],
  reviews: [],
  dayKey: null,
};

let state = null;
let writeTimer = null;

const id = (prefix) => prefix + '_' + crypto.randomBytes(6).toString('hex');

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const k of Object.keys(SEED)) if (state[k] === undefined) state[k] = SEED[k];
  } catch {
    state = JSON.parse(JSON.stringify(SEED));
    state.dayKey = time.serviceDayKey();
    persist(true);
  }
  return state;
}

function persist(immediate) {
  if (immediate) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, FILE); // atomic: never leave a half-written db behind
    return;
  }
  if (writeTimer) return;
  writeTimer = setTimeout(() => { writeTimer = null; persist(true); }, 200);
}

/**
 * Drops yesterday's votes. Called before every read and write, so the wipe
 * happens even if the process was asleep or restarted across 23:00.
 * Reviews are deliberately untouched.
 */
function rollover() {
  const s = load();
  const key = time.serviceDayKey();
  if (s.dayKey !== key) {
    const dropped = s.votes.length;
    s.votes = [];
    s.dayKey = key;
    persist(true);
    if (dropped) console.log(`[reset] se borraron ${dropped} voto(s), arranca el día ${key}`);
    return true;
  }
  return false;
}

const norm = (name) => String(name || '').trim().replace(/\s+/g, ' ');
const key = (name) => norm(name).toLowerCase();

// ------------------------------------------------------------------ queries

function restaurants() {
  return load().restaurants;
}

function reviewStats(restaurantId) {
  const list = load().reviews.filter((r) => r.restaurantId === restaurantId);
  const avg = list.length ? list.reduce((a, r) => a + r.rating, 0) / list.length : 0;
  return { count: list.length, average: Math.round(avg * 10) / 10 };
}

/** Board state for one slot: options sorted by votes, with voters and ratings. */
function board(slot) {
  rollover();
  const s = load();
  const options = s.restaurants
    .filter((r) => r.slots.includes(slot))
    .map((r) => {
      const votes = s.votes.filter((v) => v.slot === slot && v.restaurantId === r.id);
      return {
        ...r,
        votes: votes.length,
        voters: votes
          .sort((a, b) => a.ts - b.ts)
          .map((v) => ({ name: v.name, note: v.note || '' })),
        rating: reviewStats(r.id),
      };
    })
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
  return options;
}

/** Recent activity. Votes are scoped to `slot`; reviews aren't slot-specific. */
function feed(limit, slot) {
  rollover();
  const s = load();
  const byId = Object.fromEntries(s.restaurants.map((r) => [r.id, r]));
  const votes = slot ? s.votes.filter((v) => v.slot === slot) : s.votes;
  const items = [
    ...votes.map((v) => ({ type: 'vote', ts: v.ts, name: v.name, place: byId[v.restaurantId]?.name, note: v.note })),
    ...s.reviews.map((r) => ({ type: 'review', ts: r.ts, name: r.name, place: byId[r.restaurantId]?.name, rating: r.rating, text: r.text })),
  ].sort((a, b) => b.ts - a.ts);
  return items.slice(0, limit || 12);
}

function reviews(restaurantId) {
  return load().reviews
    .filter((r) => r.restaurantId === restaurantId)
    .sort((a, b) => b.ts - a.ts);
}

// ----------------------------------------------------------------- mutations

/** One vote per person per slot per day; voting again moves the vote. */
function vote({ name, restaurantId, slot, note }) {
  rollover();
  const s = load();
  const person = norm(name);
  if (!person) throw new Error('Falta tu nombre');
  if (person.length > 24) throw new Error('El nombre es muy largo');
  const place = s.restaurants.find((r) => r.id === restaurantId);
  if (!place) throw new Error('Ese lugar no existe');
  if (!place.slots.includes(slot)) throw new Error(`${place.name} no está en ${slot === 'lunch' ? 'el almuerzo' : 'la merienda'}`);

  const existing = s.votes.findIndex((v) => v.slot === slot && key(v.name) === key(person));
  const entry = {
    id: id('v'), name: person, restaurantId, slot,
    note: String(note || '').trim().slice(0, 60), ts: Date.now(),
  };
  let action = 'added';
  if (existing >= 0) {
    if (s.votes[existing].restaurantId === restaurantId && !note) {
      s.votes.splice(existing, 1); // tapping your own choice again removes it
      persist();
      return { action: 'removed' };
    }
    s.votes[existing] = entry; // fresh ts, so the screen shouts the move too
    action = 'moved';
  } else {
    s.votes.push(entry);
  }
  persist();
  return { action, vote: entry };
}

function unvote({ name, slot }) {
  rollover();
  const s = load();
  const before = s.votes.length;
  s.votes = s.votes.filter((v) => !(v.slot === slot && key(v.name) === key(name)));
  persist();
  return { removed: before - s.votes.length };
}

function addReview({ name, restaurantId, rating, text }) {
  const s = load();
  const person = norm(name);
  if (!person) throw new Error('Falta tu nombre');
  if (!s.restaurants.some((r) => r.id === restaurantId)) throw new Error('Ese lugar no existe');
  const stars = Math.round(Number(rating));
  if (!(stars >= 1 && stars <= 5)) throw new Error('La puntuación va de 1 a 5');
  const review = {
    id: id('rev'), restaurantId, name: person, rating: stars,
    text: String(text || '').trim().slice(0, 240), ts: Date.now(),
  };
  s.reviews.push(review);
  persist();
  return review;
}

function saveRestaurant(input) {
  const s = load();
  const slots = (input.slots || []).filter((x) => x === 'lunch' || x === 'snack');
  if (!slots.length) throw new Error('Elegí al menos un turno');
  const name = norm(input.name);
  if (!name) throw new Error('Falta tu nombre');
  const data = {
    name,
    cuisine: norm(input.cuisine) || 'Food',
    emoji: (input.emoji || '🍴').slice(0, 4),
    slots,
  };
  const existing = s.restaurants.find((r) => r.id === input.id);
  if (existing) Object.assign(existing, data);
  else s.restaurants.push({ id: id('r'), ...data });
  persist();
  return existing || s.restaurants[s.restaurants.length - 1];
}

function deleteRestaurant(restaurantId) {
  const s = load();
  s.restaurants = s.restaurants.filter((r) => r.id !== restaurantId);
  s.votes = s.votes.filter((v) => v.restaurantId !== restaurantId);
  persist();
}

/** Manual wipe, used by the admin "reset today" button. */
function resetVotes() {
  const s = load();
  const n = s.votes.length;
  s.votes = [];
  s.dayKey = time.serviceDayKey();
  persist(true);
  return n;
}

function myVote({ name, slot }) {
  rollover();
  return load().votes.find((v) => v.slot === slot && key(v.name) === key(name)) || null;
}

module.exports = {
  load, rollover, restaurants, board, feed, reviews, reviewStats,
  vote, unvote, addReview, saveRestaurant, deleteRestaurant, resetVotes, myVote, FILE,
};
