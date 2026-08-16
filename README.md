# Mirror — Skin & Style Studio

**YouCam API Skin AI & Apparel VTO Hackathon — combined track.**

Mirror reads your skin, derives which garment colours flatter it, and renders you
wearing them. The two YouCam APIs are not two features side by side: the skin
analysis output is the *input* to the wardrobe logic.

## The idea

Most try-on tools answer "does this fit". They cannot answer "does this suit
me", because they know nothing about the face above the collar. Mirror does.

1. **Analyse** — one selfie goes to YouCam **AI Skin Analysis**, returning eight
   concern scores (redness, age spots, texture, acne, oiliness, moisture,
   radiance, pores).
2. **Derive** — [`src/lib/styleProfile.ts`](src/lib/styleProfile.ts) converts
   those scores into a wardrobe palette. The reasoning is simultaneous contrast
   (Chevreul): a garment sitting next to skin pushes the skin's apparent hue
   toward the garment's complement. High redness therefore steers toward
   blue-greens, which visually settle it, and away from scarlet and coral, which
   echo it. Redness severity also drives an undertone read that selects between
   warm and cool neutrals.
3. **Try on** — YouCam **AI Clothes Virtual Try-On (v4)** renders the ranked
   garments on the user's own photo, each labelled with the skin-derived reason
   it was picked.

Every recommendation shows its reasoning, so the advice is never a black box.

## YouCam APIs used

| API | Endpoint | Role |
| --- | --- | --- |
| File API | `POST /s2s/v2.0/file` | Uploads the selfie, returns a `file_id` reused by both tasks |
| AI Skin Analysis | `POST /s2s/v2.0/task/skin-analysis` | Eight SD concern scores |
| AI Clothes VTO v4 | `POST /s2s/v2.0/task/cloth-v4` | Renders garments on the user |

Base URL `https://yce-api-01.makeupar.com`, authenticated with
`Authorization: Bearer <API_KEY>`.

Implementation notes worth flagging, all learned from the API reference:

- Skin analysis is called with `format: "json"` — the API defaults to `zip`,
  which returns a different response shape entirely.
- Scores run **1-100 where higher means healthier**, so severity is `100 - score`.
- `raw_score` drives the logic; `ui_score` is documented as deliberately
  flattered upward and is display-only.
- HD and SD concern sets cannot be mixed in one request. Mirror uses SD.
- Tasks are polled to completion. Abandoning a running task expires it into
  `InvalidTaskId` **while still consuming units**, so the client always polls
  through to `success` or `error`.

## Store owners

Shoppers stay anonymous. A retailer signs in with **Clerk** (the *Store* screen)
and stocks the same shelves the prescription ranks, so their products compete on
colour match rather than being pinned to the top.

- `POST /api/products` takes ownership from the verified Clerk session token,
  never from the request body, so an owner can only touch their own rows.
- `POST /api/products/import` takes an **.xlsx or .csv** with a header row —
  columns `name, brand, aisle, hex, image, price, url`, matched by name so the
  order does not matter. `name`, `hex` and `image` are required. Bad rows are
  reported by spreadsheet line number and the good ones still import; the format
  is sniffed from the file's bytes, not its extension.
- `GET /api/products` is public — it is what `/api/shop` merges onto the
  shelves — and strips owner ids, adding `mine` only for a signed-in owner.
- Product images must be public `https` URLs: try-on fetches them from YouCam's
  own servers.

Products live in `products.json` beside the server — no database to run. Add the
Clerk keys from `.env.example`; without them the app still works for shoppers and
the Store screen explains the setup.

## Architecture

```
src/            React PWA (installable, works as web app and mobile app)
  lib/styleProfile.ts   Skin scores -> wardrobe palette. The core idea.
  lib/garments.ts       Catalog + palette-based ranking
api/            Serverless functions holding the API key
  _youcam.ts            YouCam client: upload, run, poll
  analyze.ts            POST /api/analyze
  tryon.ts              POST /api/tryon
```

The YouCam key is server-side only. The browser talks to `/api/*` and never sees
it, so opening devtools cannot drain the account's units.

## Running locally

```bash
npm install
cp .env.example .env      # add your YouCam key
npm run dev               # builds, then serves app + API on :3000
```

`server.js` is a dependency-free Node server that serves the built frontend and
the API routes together, so there is no platform lock-in. The route handlers are
plain `(Request) => Response` functions, so they also drop into Vercel, Netlify,
or Cloudflare Workers unchanged.

Requires Node 22+ (uses `--experimental-strip-types` to run the TypeScript
handlers directly).

### Try-on needs a public URL

The VTO API fetches the garment image from *its* servers, so it cannot reach
`localhost`. Skin analysis works locally because that image is uploaded rather
than fetched. To demo try-on end to end, deploy the app or expose it with a
tunnel. Running locally, the app says so instead of failing opaquely.

## Photo requirements

Front-facing, evenly lit, face filling most of the frame, JPEG or PNG under
10MB. Try-on additionally wants a full-length standing shot. The app maps the
API's error codes to plain-language guidance when a photo does not qualify.

## Licence

MIT. See [LICENSE](LICENSE).
