# Mirror

**YouCam API Skin AI & Apparel VTO Hackathon — combined track.**

Mirror reads one selfie and shops for you. Every product it shows names the
measurement that chose it, and you can see most of them on your own face.

## The idea

Skin has two separate properties, and shops only ever use one of them.

Your skin **colour** picks the *shade*. Your skin **condition** picks the
*formula*. Two people can match the identical foundation shade and need
opposite products: one reads oily and is prescribed matte, the other reads dry
and is prescribed dewy. The diagnosis changes the product, not just the caption.

That is the whole build. Nine YouCam endpoints feed one decision.

## What it does

1. **Scan.** One photo runs three YouCam reads in parallel: skin colour, seven
   skin concerns, and face attributes.
2. **Diagnose.** Colour becomes an undertone, a depth and a seasonal palette.
   Concerns become a formula: glow, coverage and under-eye intensities, each
   printed with the reading that produced it.
3. **Shop.** Six aisles, each ranked by a different question, because they are
   asking different things. Foundation must *match* your skin; blush and
   clothes must *flatter* it; skincare aims at what your scan flagged.
4. **Try on.** Foundation, lipstick, blush, clothes and hair render on your own
   photo. The makeup render carries *your* prescribed intensities, so it is
   your formula in that shade rather than a preset.

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
| `GET /s2s/v2.x/task/template/*` | YouCam's own garment and hair catalogues |

Base URL `https://yce-api-01.makeupar.com`, authenticated with
`Authorization: Bearer <API_KEY>`.

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

Any shop can list products (`/store`), and uploaded rows join the public feeds
rather than replacing them, ranked on the same footing: reach comes from
matching the shopper. Rows without a resolvable colour are rejected with a
reason, since every ranker sorts on colour. Orders take ids and quantities only
and are re-priced server-side.

## Running it

```bash
bun install
cp .env.example .env      # add your YouCam key
bun run build
bun run api               # app and API on :8787
```

For frontend hot reload, run `bun run dev` alongside `bun run api`; Vite
proxies `/api` through.

Requires Bun 1.3+. `GEMINI_API_KEY` is optional and only adds prose.

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
