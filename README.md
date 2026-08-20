# QUÉ COMEMOS?

A wall-screen board for the office lunch problem: someone says *"pido de Kiddo"* and then
five people ask "me sumás?" in five separate messages. This puts the question on the
screen, and everyone answers it from their phone by scanning a QR.

The UI is entirely in rioplatense Spanish; the code and this file are in English.

- **Wall screen** (`/`) — auto-scrolling carousel of today's options with live counts
  (**YENDO**), who's going, what they're getting, and star ratings. Every new vote takes
  over the screen with confetti: **"ANTO SUMA PARA KIDDO"**.
- **Phones** (`/m`) — scan the QR, type your name once, hit **Sumo**, optionally say what
  you're getting ("Doble cheddar"). Read and write reseñas per place, and **add new
  places** yourself.
- **Admin** (`/admin`) — edit or remove places, force a vote reset.

The board is responsive: it's designed at 1920×1080 for the office TV and reflows down to
laptops, tablets and portrait screens (the header stacks, the cards narrow).

Zero dependencies: Node's standard library, vanilla JS, a QR encoder and a confetti
renderer written for this project.

## Run it

```bash
npm start            # or: node server.js
```

```
wall screen : http://localhost:8080/
phones      : http://<your-lan-ip>:8080/m     <- what the QR encodes
admin       : http://localhost:8080/admin
```

Open the wall screen on the office TV in fullscreen. It's designed at 1920×1080 and every
size is expressed in `rem`, so the whole board scales from a single root font-size that
display.js computes from the viewport. Below a 1.25 aspect ratio it switches to a stacked
layout for tablets and portrait screens.

| env var | default | meaning |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `PUBLIC_URL` | auto-detected LAN IP | what the QR points at (set this behind a tunnel/reverse proxy) |

The auto-detection asks the kernel which interface carries the default route (via a
UDP socket that sends nothing) and ignores link-local `169.254.x.x` addresses, so an
unplugged dongle or a NIC without a lease can't hijack the QR. It re-checks every 15s
and the wall screen redraws the code if the address changes.
| `ALLOW_CLOSED_VOTES` | unset | `1` lets people vote outside the windows (handy for demos) |

## Timing (Argentina, `America/Argentina/Buenos_Aires`)

| Argentina time | What the screen shows | Voting |
| --- | --- | --- |
| 00:00–10:59 | Almuerzo, *abre en …* | open (vote early) |
| 11:00–13:59 | **Almuerzo**, *cierra en …* | open |
| 14:00–16:59 | **Merienda**, *cierra en …* | open |
| 17:00–22:59 | Almuerzo, *abre mañana* | closed |
| **23:00** | — | **all votes wiped, reviews kept** |

The wipe is keyed on a "service day" that rolls over at 23:00, and it is re-checked on
every read and write. So the reset still happens correctly if the server was asleep,
restarted, or offline across 23:00 — not just if a timer happened to fire.

Almuerzo runs straight into merienda at 14:00, so there is no dead time between them.
Voting is deliberately open before the first window (people decide early) and blocked in
the evening, since anything voted after 17:00 would be erased at 23:00 anyway. Set
`ALLOW_CLOSED_VOTES=1` to lift that.

Windows and the reset hour live at the top of [lib/time.js](lib/time.js).

## Rules

- One vote per person per slot per day, keyed on name (case-insensitive).
  Voting for a different place *moves* your vote (and the screen shouts the move too);
  tapping your own choice again clears it.
- **Only votes are deleted**, every night at 23:00. Places and reseñas are permanent.
- Anyone can add a place from their phone (`POST /api/place`). A place can be assigned to
  lunch, snack, or both. Removing one is deliberately admin-only.

The places it ships with, all six assigned to both almuerzo and merienda: Casa Endivia
(ensaladas), Kiddo (hamburguesas), Ipolitina (pizza y sandwiches), Darwin (tarta), Aspen
(fideos), Mon Poulet (pollo).

## Layout

```
server.js          HTTP + JSON API + SSE broadcast
lib/qr.js          QR encoder (byte mode, versions 1-10, ECC L/M) - runs in Node and the browser
lib/net.js         picks the LAN address the QR points at
lib/time.js        Argentina clock, slot windows, 23:00 service-day rollover
lib/db.js          JSON store with atomic writes, vote/review rules
public/display.*   the wall screen (1920x1080 by design, responsive), confetti takeover
                   the carousel repeats the list until it covers the screen, so it never
                   scrolls into blank space when there are only a couple of options
public/mobile.*    the phone page
public/admin.*     restaurant assignment
data/db.json       created on first run, seeded with example places
tools/             QR verification harness (see below)
```

### API

| method | path | body / query |
| --- | --- | --- |
| GET | `/api/state` | `?slot=lunch\|snack` to pin a slot (otherwise follows the clock) |
| GET | `/api/reviews` | `?restaurantId=` |
| GET | `/api/me` | `?name=&slot=` |
| GET | `/api/stream` | SSE; emits on every change |
| POST | `/api/vote` | `{name, restaurantId, slot?, note?}` |
| POST | `/api/unvote` | `{name, slot?}` |
| POST | `/api/review` | `{name, restaurantId, rating: 1-5, text?}` |
| POST | `/api/place` | `{name, cuisine, emoji, slots[]}` — create-only, used by the phone UI |
| GET/POST/DELETE | `/api/admin/restaurant(s)` | `{id?, name, cuisine, emoji, slots[]}` |
| POST | `/api/admin/reset` | clears today's votes now |

Handy URL flags: `/?slot=snack` pins the board to a slot, and `?nostream=1` on either page
disables the live connection (used for screenshots and kiosk debugging).

## The QR encoder

`lib/qr.js` is a from-scratch QR encoder (GF(256) Reed–Solomon, all 8 masks with the
standard penalty rules, format/version BCH). It is verified against a real decoder rather
than trusted: `tools/qr-png.js` renders a symbol to PNG and `tools/decode.swift` reads it
back with macOS Vision.

```bash
npm run verify-qr
```

All 20 version/ECC combinations (v1–v10 × L,M) were round-tripped at maximum payload
length through that decoder, and the QR as rendered on the wall screen was cropped from a
screenshot and decoded back to the join URL.

## Notes

- There is no authentication — it assumes an office LAN and a screen everybody can see.
  `/admin` is reachable by anyone who knows the URL.
- Identity is just a typed name (remembered in `localStorage`), so someone can vote as
  someone else. That matches how the WhatsApp thread it replaces already worked.
