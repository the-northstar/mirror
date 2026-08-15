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
npx vercel dev            # serves the app and /api together on :3000
```

`npm run dev` alone starts only the frontend; the API routes need `vercel dev`
(or any host that runs the `api/` directory) to respond.

## Photo requirements

Front-facing, evenly lit, face filling most of the frame, JPEG or PNG under
10MB. Try-on additionally wants a full-length standing shot. The app maps the
API's error codes to plain-language guidance when a photo does not qualify.

## Licence

MIT.
