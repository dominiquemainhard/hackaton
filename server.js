'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const db = require('./lib/db.js');
const net = require('./lib/net.js');
const time = require('./lib/time.js');

const PORT = Number(process.env.PORT || 8080);
/** Changes on every restart; the wall screen reloads itself when it sees a new one. */
const BOOT_ID = String(Date.now());
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** The LAN address of this machine, for when the app runs on someone's laptop. */
function lanUrl() {
  const best = net.lanAddresses()[0];
  return best ? `http://${best.address}:${PORT}` : `http://localhost:${PORT}`;
}

const LOCAL_HOST = /^(localhost|127\.|\[?::1)/;

/**
 * Where phones should point their browser. Hosted anywhere with a real
 * hostname (Vercel, Render, ngrok) the request already tells us the public
 * address; only on a laptop, where the screen is opened at localhost, do we
 * have to go looking for the LAN address.
 */
function joinUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '') + '/m';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host && !LOCAL_HOST.test(host)) {
    const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
    return `${proto}://${host}/m`;
  }
  return lanUrl() + '/m';
}

// ------------------------------------------------------------------ SSE hub
const clients = new Set();

function broadcast() {
  const payload = `data: ${JSON.stringify({ ts: Date.now() })}\n\n`;
  for (const res of clients) res.write(payload);
}

// ------------------------------------------------------------------ helpers
function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || MIME['.json'],
    'Cache-Control': 'no-store',
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e5) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, urlPath) {
  const rel = urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'not found' });
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

function stateFor(slotOverride, req) {
  const t = time.describe();
  const url = joinUrl(req);
  const slot = slotOverride === 'lunch' || slotOverride === 'snack' ? slotOverride : t.slot;
  if (slot !== t.slot) {
    // Pinned view: label the slot being shown, not the one the clock is in.
    const w = time.WINDOWS[slot];
    const pad = (h) => String(h).padStart(2, '0');
    t.slotLabel = w.label;
    t.slotEmoji = w.emoji;
    t.window = `${pad(w.start)}:00-${pad(w.end)}:00`;
    t.countdown = { label: 'vista fija', minutes: null };
  }
  return {
    boot: BOOT_ID,
    time: t,
    slot,
    pinned: slot !== t.slot,
    options: db.board(slot),
    feed: db.feed(14, slot),
    joinUrl: url,
    // Only true when nothing can reach us: no hostname and no LAN address.
    reachable: !/^https?:\/\/(localhost|127\.)/.test(url),
    votingOpen: t.phase !== 'closed' || process.env.ALLOW_CLOSED_VOTES === '1',
  };
}

/**
 * Who is hitting us, and from where. Static assets are noise, but the page
 * loads and the API calls tell you whether a phone is reaching the machine at
 * all — the difference between "the network blocks it" and "it loaded and
 * something else broke".
 */
function logRequest(req, url) {
  if (/\.(css|js|ico|svg|png)$/.test(url.pathname)) return;
  if (url.pathname === '/api/stream') return;
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const who = ip === '::1' || ip === '127.0.0.1' ? 'esta compu' : ip;
  const clock = time.describe().clock;
  console.log(`  ${clock}  ${req.method} ${url.pathname}${url.search}  <- ${who}`);
}

// -------------------------------------------------------------------- routes
async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  logRequest(req, url);

  try {
    if (p === '/' ) return serveStatic(res, 'display.html');
    if (p === '/m' || p === '/vote') return serveStatic(res, 'mobile.html');
    if (p === '/admin') return serveStatic(res, 'admin.html');
    if (p === '/lib/qr.js') {
      return fs.readFile(path.join(__dirname, 'lib', 'qr.js'), (e, d) =>
        e ? send(res, 404, { error: 'not found' }) : send(res, 200, d, MIME['.js']));
    }

    if (p === '/api/state' && req.method === 'GET') {
      return send(res, 200, stateFor(url.searchParams.get('slot'), req));
    }

    if (p === '/api/reviews' && req.method === 'GET') {
      const rid = url.searchParams.get('restaurantId');
      return send(res, 200, { reviews: db.reviews(rid), stats: db.reviewStats(rid) });
    }

    if (p === '/api/me' && req.method === 'GET') {
      const name = url.searchParams.get('name') || '';
      const slot = url.searchParams.get('slot') || time.describe().slot;
      return send(res, 200, { vote: db.myVote({ name, slot }) });
    }

    if (p === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.method === 'POST' && p === '/api/vote') {
      const body = await readBody(req);
      const t = time.describe();
      const slot = body.slot === 'lunch' || body.slot === 'snack' ? body.slot : t.slot;
      if (t.phase === 'closed' && process.env.ALLOW_CLOSED_VOTES !== '1') {
        return send(res, 409, { error: 'Ya cerró por hoy. El almuerzo abre a las 11:00.' });
      }
      const result = db.vote({ ...body, slot });
      broadcast();
      return send(res, 200, { ok: true, ...result });
    }

    if (req.method === 'POST' && p === '/api/unvote') {
      const body = await readBody(req);
      const slot = body.slot || time.describe().slot;
      const result = db.unvote({ name: body.name, slot });
      broadcast();
      return send(res, 200, { ok: true, ...result });
    }

    if (req.method === 'POST' && p === '/api/review') {
      const review = db.addReview(await readBody(req));
      broadcast();
      return send(res, 200, { ok: true, review });
    }

    // Anyone can add a place from their phone. Places are permanent: only votes
    // get wiped daily, never the option list.
    if (p === '/api/place' && req.method === 'POST') {
      const body = await readBody(req);
      delete body.id;
      const place = db.saveRestaurant(body);
      broadcast();
      return send(res, 200, { ok: true, place });
    }

    if (p === '/api/admin/restaurants' && req.method === 'GET') {
      return send(res, 200, { restaurants: db.restaurants() });
    }

    if (p === '/api/admin/restaurant' && req.method === 'POST') {
      const saved = db.saveRestaurant(await readBody(req));
      broadcast();
      return send(res, 200, { ok: true, restaurant: saved });
    }

    if (p === '/api/admin/restaurant' && req.method === 'DELETE') {
      db.deleteRestaurant((await readBody(req)).id);
      broadcast();
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/reset' && req.method === 'POST') {
      const n = db.resetVotes();
      broadcast();
      return send(res, 200, { ok: true, cleared: n });
    }

    return serveStatic(res, p);
  } catch (err) {
    return send(res, 400, { error: err.message || 'bad request' });
  }
}

const server = http.createServer(handleRequest);

// Serverless platforms import the handler and run it per request; there is no
// process to listen or tick. Only do that when started directly.
module.exports = handleRequest;
module.exports.server = server;

if (require.main !== module) return;

// Keeps clocks, slot switches and the 23:00 wipe live on the wall screen.
setInterval(() => {
  net.refreshRoutedAddress(broadcast); // networks change; the QR should follow
  const rolled = db.rollover();
  if (rolled) broadcast();
  for (const res of clients) res.write(': ping\n\n');
}, 15000);

let lastSlot = time.describe().slot + time.describe().phase;
setInterval(() => {
  const t = time.describe();
  if (t.slot + t.phase !== lastSlot) {
    lastSlot = t.slot + t.phase;
    broadcast();
  }
}, 5000);

net.refreshRoutedAddress(broadcast);

server.listen(PORT, () => {
  const t = time.describe();
  console.log(`\n  QUÉ COMEMOS?`);
  console.log(`  pantalla  : http://localhost:${PORT}/`);
  console.log(`  celulares : ${lanUrl()}/m   <- lo que apunta el QR`);
  for (const { name, address } of net.lanAddresses().slice(1)) {
    console.log(`              http://${address}:${PORT}/m   (${name}, alternativa)`);
  }
  console.log(`  admin     : http://localhost:${PORT}/admin`);
  console.log(`  argentina : ${t.clock} · ${t.slotLabel} (${t.phase}) · los votos se borran a las ${t.resetHour}:00\n`);
});
