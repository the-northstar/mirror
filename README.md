# Mirror

**YouCam API Skin AI & Apparel VTO Hackathon — combined track.**

Mirror reads one selfie and shops for you. Every product it shows names the
measurement that chose it, and you can see most of them on your own face.

**Live: [mirror.pykero.com](https://mirror.pykero.com)** — no sign-in needed to
scan and shop. Android APK: [`mirror.apk`](mirror.apk).

## The idea

Skin has two separate properties, and shops only ever use one of them.

Your skin **colour** picks the *shade*. Your skin **condition** picks the
*formula*. Two people can match the identical foundation shade and need
opposite products: one reads oily and is prescribed matte, the other reads dry
and is prescribed dewy. The diagnosis changes the product, not just the caption.

Every shade finder online stops at the first half. It matches a colour and
hands you a list. Nothing you can measure about your face — oiliness, moisture,
redness, texture, face shape — enters the decision, so the right colour arrives
in the wrong formula and gets returned or abandoned in a drawer.

That is the whole build. Thirteen YouCam endpoints feed one decision.

### The problems this solves

**For the shopper — "will this actually suit me?"**
Shade finders match a colour and stop. Mirror measures seven skin concerns and
a face shape too, so the *formula* is prescribed alongside the shade, and every
product names the reading that chose it. Then it renders that product onto your
own photo, so the answer is visible rather than promised. One selfie sets a
reading that every aisle reuses — no re-scan per category.

**For the store — "I have a catalogue, not an engineering team."**
Most personalisation tools need a developer, a data pipeline and a redesign.
Here a shop signs in, uploads a spreadsheet or points at a feed it already
publishes, and its products are ranked against real shoppers within a minute.
No tagging: colours are measured from the product photos server-side, so a
merchant never hand-labels "warm beige".

**For the store again — "I don't want to send my customers somewhere else."**
The SDK puts the whole engine on the retailer's own storefront, ranking *their*
catalogue. One `<script>` tag, or a headless client if they want their own UI.

**Recommendations you can audit.**
Ranking is code — colour distance in CIELAB, per-aisle objectives — not a model
guessing. A language model only picks one product from a shortlist of twelve
that code already ranked, and writes one sentence. It can never invent a
product, and when it is absent the app still recommends, labelled as a colour
match rather than advice.

**A shelf that does not go dark.** Public feeds fail. Each aisle falls back on
its own, so a dead lipstick feed cannot cost you the foundation match, and a
committed catalogue of 576 measured products keeps the shelves stocked on a
fresh checkout with no network at all.

## What it does

1. **Scan.** One photo runs three YouCam reads in parallel: skin colour, seven
   skin concerns, and face attributes.
2. **Diagnose.** Colour becomes an undertone, a depth and a seasonal palette.
   Concerns become a formula: glow, coverage and under-eye intensities, each
   printed with the reading that produced it.
3. **Shop.** Seven aisles, each ranked by a different question, because they
   are asking different things. Foundation must *match* your skin; blush and
   clothes must *flatter* it; skincare aims at what your scan flagged.
4. **Try on.** Foundation, lipstick, blush, clothes, hair and whole looks
   render on your own photo. The makeup render carries *your* prescribed
   intensities, so it is your formula in that shade rather than a preset.
5. **Buy.** Anything a listed store sells can be ordered; the store sees it in
   their dashboard. Feed-only rows are not orderable, because there is no
   merchant to fulfil them.

And on the other side of the counter:

6. **List.** A shop signs in, uploads a spreadsheet or points at a feed it
   already publishes, and its products are ranked against real shoppers — with
   colours measured from the photos, not hand-tagged.
7. **Embed.** Or it skips Mirror entirely and puts the engine on its own
   storefront with one `<script>` tag, ranking its own catalogue.

## YouCam APIs used

| Endpoint | Role |
| --- | --- |
| `POST /s2s/v2.0/file` | Uploads the photo once; every task reuses the id |
| `POST /s2s/v2.0/task/skin-tone-analysis` | Skin, lip, eye, brow and hair colour |
| `POST /s2s/v2.0/task/skin-analysis` | Seven SD concern scores plus masks |
| `POST /s2s/v2.0/task/face-attr-analysis` | Face shape, age, gender |
| `POST /s2s/v2.0/task/makeup-vto` | Foundation, lipstick and blush on the face |
| `POST /s2s/v2.0/task/cloth-v4` | A garment photo rendered on the shopper |
| `POST /s2s/v2.0/task/cloth` | Template garments (v4 dropped `template_id`) |
| `POST /s2s/v2.1/task/hair-transfer` | A hairstyle rendered on the shopper |
| `POST /s2s/v2.0/task/look-vto` | A whole look in one pass (wired; no shelf, see below) |
| `POST /s2s/v2.0/task/skin-simulation` | The same face after a course of treatment |
| `GET /s2s/v2.0/task/template/cloth` | YouCam's garment catalogue |
| `GET /s2s/v2.0/task/template/look-vto` | YouCam's artist look catalogue |
| `GET /s2s/v2.1/task/template/hair-transfer` | YouCam's hairstyle catalogue |

Base URL `https://yce-api-01.makeupar.com`, authenticated with
`Authorization: Bearer <API_KEY>`.

**What each one decides.** With one named exception, nothing here is called for
display only — every response changes a product that gets recommended:

- **`skin-tone-analysis`** is the spine. The measured skin hex becomes an
  undertone and a depth in CIELAB, which becomes a seasonal palette, which
  ranks *every* aisle — clothes included. The measured lip colour anchors
  lipstick ranking so a recommendation flatters the mouth you have.
- **`skin-analysis`** turns seven concern scores into the **formula**: finish,
  glow, coverage and under-eye intensities. This is the half other tools skip,
  and it is why the same matched shade is prescribed matte on oily skin and
  dewy on dry. It also aims the skincare aisle at what the scan actually
  flagged.
- **`face-attr-analysis`** gives face shape, which decides hairstyle ranking,
  and a detected gender that *preselects* the Women's / Men's / Everything
  control. The shopper's own answer is what filters the shelves; the detection
  only fills it in, because a guess is good enough to preselect a control and
  not good enough to hide an aisle on its own.
- **`makeup-vto`** renders foundation, lipstick and blush carrying **your**
  prescribed intensities, so the try-on is your formula in that shade rather
  than a stock preset.
- **`cloth-v4`** renders any garment from its own product photo, which is what
  lets a merchant's uploaded row be tried on minutes after upload.
  **`cloth`** covers YouCam's template garments, since v4 dropped `template_id`.
- **`hair-transfer`** renders a cut in one pass, ranked against the measured
  face shape. **`look-vto`** is wired and works, but has no shelf: on this key
  its template catalogue is 240 entries across Animals and Sports, all of it
  novelty face paint rather than anything a shopper buys.
- **`skin-simulation`** shows the same face after a course of treatment — the
  argument for a skincare product, made on the shopper's own photo.
- **`file`** uploads the photo once; every task above reuses that id, so a
  seven-aisle session costs one upload rather than nine.

### Things that cost real debugging

- Auth is a **plain bearer key**. There is a legacy `/s2s/v1.0/client/auth` RSA
  handshake, and `YOUCAM_SECRET_KEY` is such a key, but v2.x does not use it.
- Skin analysis defaults to `format: "zip"`, a completely different response
  shape. Pass `"json"`.
- Scores run **1-100 where higher is healthier**, so severity is `100 - score`.
  Inverting this twice prescribes the exact opposite formula and still reads
  plausible.
- `skin-tone-analysis` returns `results` as an **object**, not an array.
  Reading `results[0]` yields nothing and looks like it works.
- HD and SD concerns cannot be mixed in one request.
- `face-attr-analysis` rejects the documented nested envelope; the deployed
  endpoint wants a flat body with camelCase `features`.
- `template_id` only works on `/task/cloth`. `cloth-v4` requires an image.
- Uploads expire. A stale `file_id` fails as `unknown_internal_error`, which
  says nothing; the app maps it to "scan again".
- Tasks must be polled to completion. An abandoned task still consumes units.

## Where the thinking lives

```
src/lib/color.ts         Lab, deltaE, undertone, depth, chroma-weighted colour
src/lib/prescription.ts  Concerns -> formula. The idea, in one file.
src/lib/rank.ts          One ranker per aisle
src/lib/catalogue.ts     Feeds, merchant stores, orders
src/lib/judge.ts         LLM re-ranker (never a retriever)
src/lib/youcam.ts        API client and fault ownership
server.ts                Bun proxy. The API key never reaches the browser.
```

Two decisions worth knowing:

**Undertone is not hue.** Hue is right for product colours but saturates near
0.94-0.99 on real skin, so every shopper comes out orange. Yellowness over
redness in Lab separates cleanly, and that is what decides it.

**The LLM is a re-ranker, never a retriever.** Code narrows each aisle; the
model picks one and writes a line. Ids are verified against the shortlist it
was *offered*, not merely against the catalogue, because a real product it was
never shown is also wrong. Without a model the app loses prose, not
recommendations, and a fallback is labelled rather than passed off as advice.

## Merchants

A shop signs in at `/store` and gets a catalogue, a dashboard and an order book.

**Getting products in.** One at a time through a form, or the whole catalogue
from an **`.xlsx` or `.csv` upload** — the same spreadsheet a shop already
keeps. Product photos upload with the row. Column order does not matter, only
the header names.

**Nothing is hand-tagged.** A merchant supplies a photo and a price; the colour
is *measured* from the image server-side (chroma-weighted average, decoded with
sharp) and named. That measurement is what ranking sorts on, which is why a row
whose colour cannot be resolved is **rejected with a reason** rather than
stored — an uncoloured row would be noise pretending to be a recommendation.

**Uploaded rows compete, they do not jump the queue.** Merchant products join
the public feeds and are ranked identically. A store gets reach by matching the
shopper, not by having uploaded. The same is true of the committed CSV
catalogue.

**Orders.** Checkout sends ids and quantities only; **every line is re-priced
server-side**, so a tampered price in the browser changes nothing. Orders are
split per store — each merchant sees only their own lines, with revenue, units
and a best-seller table in the Finance tab. Products from public feeds are not
orderable, because there is no merchant to fulfil them: a bag of only those
places zero orders and says so rather than failing.

**Ownership is never taken from the request body.** It comes from the signed-in
session, so a merchant can only ever read or write their own rows.

Stores, their catalogues and their orders persist to disk and are restored on
boot, so a redeploy does not empty a merchant's shelf.

## SDK

Listing on Mirror asks a shop to send its customers somewhere else. Most will
not. So the same engine drops onto the retailer's **own** storefront, scanning
their shopper and ranking **their** catalogue — Mirror becomes infrastructure
rather than a destination. Full reference: **[docs/sdk.md](docs/sdk.md)**.

One line for the widget — Mirror opens in an overlay over their site:

```html
<script src="https://mirror.pykero.com/sdk/mirror.js"
        data-store="store-acme-1" defer></script>
```

Or headless, for retailers who want their own interface:

```ts
const mirror  = createMirror({ storeId: 'store-acme-1' })
const reading = await mirror.scan(file)
const shop    = await mirror.shop(reading)
```

The widget is a thin layer over that client, so nothing is reachable through
the overlay that is not reachable without it. It renders in an iframe: the
host page's CSS cannot break the scan, and ours cannot leak onto their page.

Catalogues arrive four ways — a hosted JSON/CSV feed, a Shopify storefront
domain, an authenticated push, or inline in the snippet. All four land in the
same validation, so a row without a resolvable colour is rejected with a reason
whichever door it came through.

**A store owner gets their keys by signing in**, not by calling an API: the
Store page has an "Add to my site" tab with the store id, the key and the
snippet ready to copy. The key is an HMAC of their store id under the server
secret, so it is derived rather than stored — the same every time they look,
and it survives a restart with no datastore. A store with no owner account can
still register over `POST /api/stores` and gets a random key instead.

Either way the **key identifies the store** rather than the request body naming
one, so a key can only ever write to its own shelf.

## Running it

```bash
bun install
cp .env.example .env      # add your YouCam key
bun run build
bun run api               # app and API on :8787
```

For frontend hot reload, run `bun run dev` alongside `bun run api`; Vite
proxies `/api` through.

Requires Bun 1.3+.

`GEMINI_API_KEY` is optional. Without it the app still recommends, using the
top colour match, and labels those picks as matches rather than advice. With
it, a model picks one product per aisle from the shortlist code already ranked
and writes how they work together. Get a free key at
https://aistudio.google.com/apikey.

Deployed separately from the repo: set it in the host's environment panel, not
in a committed file. `GET /api/health` reports which layers are live on an
instance:

```json
{ "youcam": true, "stylist": false }
```

### Photo requirements

One face, close up, filling most of the frame, evenly lit. WebP, HEIC and
oversized photos are converted in the browser before upload. Skin analysis
needs a close-up; clothes try-on wants a full-length standing shot.

## Tests

```bash
bun test
```

The pure modules are fed **live API payloads verbatim**, so the tests fail if
the contract drifts rather than if an assumption changes.

## Licence

MIT. See [LICENSE](LICENSE).
