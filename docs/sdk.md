# Mirror SDK

Put Mirror's face-reading and colour matching on your own storefront, ranking
**your** catalogue. Two ways in:

- **[Widget](#1-the-widget)** — one `<script>` tag. Mirror opens in an overlay,
  scans the shopper, recommends your products. No UI work.
- **[Headless client](#2-the-headless-client)** — call the engine, render your
  own UI. The widget is built on this, so anything it shows, you can build.

Base URL: `https://mirror.pykero.com`

---

## Getting your keys

**Sign in at [/store](https://mirror.pykero.com/store) and open the
"Add to my site" tab.** Your store id and API key are already there — signing
in creates them. Copy the snippet and you are done; nothing to register.

| Field | Where it goes |
|---|---|
| Store ID | Public. Safe in your page's HTML. |
| API key | Secret. Server-side only — it can write to your catalogue. |

The key is derived from your account rather than stored, so it is the same
every time you look and it survives a restart. To rotate one, ask us — it
changes with the server secret.

<details>
<summary>Registering a store over the API instead</summary>

For a store with no owner account — a platform integrating on someone's
behalf, say:

```bash
curl -X POST https://mirror.pykero.com/api/stores \
  -H 'Content-Type: application/json' \
  -d '{"name":"Acme Beauty","contactEmail":"orders@acme.com"}'
```

```json
{ "store": { "id": "store-acme-beauty-1", "apiKey": "mk_f80808cd…" } }
```

This key is shown **once** and never appears in any listing. Both kinds of key
work identically everywhere below.

</details>

---

## 1. The widget

```html
<script src="https://mirror.pykero.com/sdk/mirror.js"
        data-store="store-acme-beauty-1" defer></script>
```

That is the whole integration. A launcher appears bottom-right; clicking it
opens Mirror in an overlay.

Mirror renders inside an iframe, so your CSS cannot break the scan and Mirror's
styles cannot leak onto your page.

### Options

Set as `data-` attributes on the script tag:

| Attribute | Default | What it does |
|---|---|---|
| `data-store` | *(required)* | Which catalogue to recommend. |
| `data-label` | `Find what suits me` | Text on the launcher button. |
| `data-target` | — | CSS selector of your own button. Suppresses the floating one. |
| `data-base` | `https://mirror.pykero.com` | Point at your own deployment. |

Using your own button:

```html
<button id="try-on">See what suits me</button>
<script src="https://mirror.pykero.com/sdk/mirror.js"
        data-store="store-acme-beauty-1" data-target="#try-on" defer></script>
```

### Controlling it from JavaScript

```js
const widget = window.Mirror.mount({ storeId: 'store-acme-beauty-1' })
widget.open()
widget.close()
```

---

## 2. The headless client

```ts
import { createMirror } from '@mirror/sdk'

const mirror = createMirror({ storeId: 'store-acme-beauty-1' })

const reading = await mirror.scan(file)   // one selfie
const shop    = await mirror.shop(reading) // ranked against your catalogue

shop.shortlists.lipstick.forEach((p) => {
  console.log(p.name, p.reason) // "Velvet Rouge — warm undertone, depth 4/6"
})
```

### Methods

| Method | Returns | Notes |
|---|---|---|
| `scan(file)` | `Reading` | Costs API units. Hold the result and reuse it. |
| `shop(reading)` | `Shop` | Ranked shortlists + a pick per aisle, each with a reason. |
| `tryOnMakeup(reading, effects)` | image URL | Renders onto the scanned face. |
| `catalogue()` | `RankedProduct[]` | Your shelf, unranked. |

`scan()` is the only call that spends units, so cache the `Reading` if the
shopper moves between pages.

Errors arrive as `MirrorError` with a `status`, so one `catch` covers the lot.

---

## Feeding your products

Four ways. Pick whichever matches what you already have.

Every row goes through the same validation whichever route it takes: **a
product without a resolvable colour is rejected, not stored.** Ranking sorts on
colour, so an uncoloured row would be noise pretending to be a recommendation.
Rejections come back with a reason.

### a. Hosted feed (recommended)

Host a JSON or CSV file and point Mirror at it. Nothing to build.

```bash
curl -X POST https://mirror.pykero.com/api/sdk/feed \
  -H 'Authorization: Bearer mk_your_key' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://acme.com/mirror-feed.json"}'
```

The format is detected from the extension; override with
`"kind": "json" | "csv" | "shopify"`. A feed is your whole catalogue, so it
**replaces** what was there.

### b. Shopify

Point at any Shopify storefront. No key, no app install.

```bash
curl -X POST https://mirror.pykero.com/api/sdk/feed \
  -H 'Authorization: Bearer mk_your_key' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://acme.myshopify.com","kind":"shopify"}'
```

Colour is read from the variant/option names, so products whose colours are
named (`Sage`, `Terracotta`) come through; unnameable ones are skipped.

### c. Push API

For catalogues that change often — push on your own schedule.

```bash
curl -X POST https://mirror.pykero.com/api/sdk/products \
  -H 'Authorization: Bearer mk_your_key' \
  -H 'Content-Type: application/json' \
  -d '{
    "replace": true,
    "products": [
      {"name":"Velvet Rouge","brand":"Acme","aisle":"lipstick",
       "hex":"#B8615C","price":29,"image":"https://acme.com/v.jpg"}
    ]
  }'
```

`replace: true` swaps the whole catalogue; omit it to append.

**The key identifies the store** — the body never names one, so a key can only
ever write to its own shelf.

### d. Inline

Small or demo catalogues, straight in the page:

```js
window.Mirror.mount({
  storeId: 'store-acme-beauty-1',
  products: [
    { name: 'Velvet Rouge', aisle: 'lipstick', hex: '#B8615C', price: 29 },
  ],
})
```

Not for large catalogues — every shopper's browser re-sends the list.

---

## Product fields

| Field | Required | Notes |
|---|---|---|
| `name` | yes | |
| `aisle` | yes | `foundation`, `lipstick`, `blush`, `skincare`, `clothes` |
| `hex` **or** `colorWord` | yes | `#B8615C`, or a name like `terracotta`. No colour → rejected. |
| `brand` | no | Defaults to your store name. |
| `price` | no | Shown in the bag; re-priced server-side at checkout. |
| `image` | no | |
| `url` | no | Link back to your own product page. |
| `shadeName` | no | `Chai`, `4W`, … |
| `audience` | no | `women`, `men`, `unisex` (default). |
| `stock` | no | |
| `tags` | no | Free text the ranker reads: ingredients, finish, metal. |
| `garmentCategory` | clothes only | `upper_body`, `full_body`, `shoes`, `outer`, `auto`. |

CSV uses the same names as its header row; column order does not matter.

---

## API reference

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/stores` | none | Create a store, get an API key. |
| `POST /api/sdk/products` | Bearer key | Push a catalogue. |
| `POST /api/sdk/feed` | Bearer key | Pull from a hosted feed or Shopify. |
| `GET /api/sdk/catalogue?storeId=` | none | Public: your shelf. |
| `POST /api/read` | none | Scan a face. |
| `POST /api/shop` | none | Rank against a reading. Pass `storeId` to scope. |
| `POST /api/tryon/makeup` | none | Render makeup onto a scan. |

SDK routes send CORS headers, so they can be called from your own domain. They
carry no cookies and no session — the only privileged routes are authenticated
by the Bearer key, which a browser never attaches on its own.

---

## Orders

Products fed by a store are orderable; public-feed rows are not, since there is
no merchant to fulfil them. A bag of only public rows places **zero** orders
and says so, rather than failing.

```bash
curl "https://mirror.pykero.com/api/orders?storeId=store-acme-beauty-1"
```
