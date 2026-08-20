'use strict';

/** Everything in this app runs on Argentina wall-clock time. */
const TZ = 'America/Argentina/Buenos_Aires';

/** Slot windows, in Argentina local hours (24h, [start, end)). */
const WINDOWS = {
  lunch: { start: 11, end: 13, label: 'ALMUERZO', emoji: '🍽️' },
  snack: { start: 15, end: 17, label: 'MERIENDA', emoji: '☕' },
};

/** Hour at which the day's votes are wiped. Reviews are never wiped. */
const RESET_HOUR = 23;

const FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

/** Current Argentina wall-clock time, broken into parts. */
function now(date) {
  const parts = {};
  for (const p of FMT.formatToParts(date || new Date())) parts[p.type] = p.value;
  const hour = parseInt(parts.hour, 10) % 24; // en-CA can emit "24" at midnight
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
    clock: `${String(hour).padStart(2, '0')}:${parts.minute}`,
    minutes: hour * 60 + parseInt(parts.minute, 10),
  };
}

/**
 * Key identifying the "service day". It rolls over at RESET_HOUR, so every
 * vote stored under an older key is stale and gets dropped on next access.
 */
function serviceDayKey(t) {
  const cur = t || now();
  if (cur.hour < RESET_HOUR) return cur.date;
  const [y, m, d] = cur.date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * Which slot the screen shows and whether voting is live.
 *  open     - inside the window, people are ordering right now
 *  upcoming - before the window, early votes welcome
 *  closed   - evening, nothing left to order today
 */
function currentSlot(t) {
  const cur = t || now();
  const h = cur.hour;
  if (h >= WINDOWS.lunch.start && h < WINDOWS.lunch.end) return { slot: 'lunch', phase: 'open' };
  if (h >= WINDOWS.snack.start && h < WINDOWS.snack.end) return { slot: 'snack', phase: 'open' };
  if (h < WINDOWS.lunch.start) return { slot: 'lunch', phase: 'upcoming' };
  if (h < WINDOWS.snack.start) return { slot: 'snack', phase: 'upcoming' };
  return { slot: 'lunch', phase: 'closed' };
}

/** Minutes until the current window closes (open) or opens (upcoming). */
function slotCountdown(t) {
  const cur = t || now();
  const { slot, phase } = currentSlot(cur);
  const w = WINDOWS[slot];
  if (phase === 'open') return { label: 'cierra en', minutes: w.end * 60 - cur.minutes };
  if (phase === 'upcoming') return { label: 'abre en', minutes: w.start * 60 - cur.minutes };
  return { label: 'abre mañana', minutes: null };
}

function describe(t) {
  const cur = t || now();
  const { slot, phase } = currentSlot(cur);
  return {
    tz: TZ,
    clock: cur.clock,
    date: cur.date,
    slot,
    phase,
    slotLabel: WINDOWS[slot].label,
    slotEmoji: WINDOWS[slot].emoji,
    window: `${String(WINDOWS[slot].start).padStart(2, '0')}:00-${String(WINDOWS[slot].end).padStart(2, '0')}:00`,
    countdown: slotCountdown(cur),
    dayKey: serviceDayKey(cur),
    resetHour: RESET_HOUR,
  };
}

module.exports = { TZ, WINDOWS, RESET_HOUR, now, serviceDayKey, currentSlot, slotCountdown, describe };
