import { useEffect, useState } from 'react'

/**
 * Try-on studio.
 *
 * Modelled on YouCam's own editor: the photo is a persistent canvas and the
 * styles dock beside it, so flipping through options never moves the thing you
 * are looking at. A card grid makes you scroll away from your own face to
 * compare, which is the wrong way round for try-on.
 */

interface Template {
  id: string
  thumb: string
  title: string
  category_name: string
}

export type StudioKind = 'cloth' | 'hair' | 'makeup'

/** A real catalogue garment, renderable because cloth-v4 takes an image URL. */
export interface StudioProduct {
  id: string
  name: string
  brand: string
  image?: string
  hex: string
}

export function Studio({
  kind,
  fileId,
  photo,
  formulaNote,
  products = [],
  makeupEffects,
  effectCategory = 'foundation',
}: {
  kind: StudioKind
  fileId: string
  photo: string | null
  /** Shown under the canvas so the render still cites the scan that drove it. */
  formulaNote?: string
  /**
   * Catalogue garments to offer beside YouCam's templates. cloth-v4 accepts an
   * arbitrary image URL, so a shop's own product renders exactly like a
   * built-in style does.
   */
  products?: StudioProduct[]
  /** Prescribed makeup effects, so a shade renders with her own intensities. */
  makeupEffects?: unknown[]
  /** Which effect the chosen swatch replaces: foundation, lip_color or blush. */
  effectCategory?: string
}) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [category, setCategory] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Makeup has no template catalogue: the shades themselves are the styles.
    if (kind === 'makeup') return
    let live = true
    fetch(`/api/${kind}/templates`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return
        const rows: Template[] = d.templates ?? []
        setTemplates(rows)
        setCategory((prev) => prev ?? rows[0]?.category_name ?? null)
      })
      .catch(() => live && setError('Could not load styles.'))
    return () => {
      live = false
    }
  }, [kind])

  const wearable = kind === 'makeup' ? products : products.filter((p) => p.image)
  const SHOP = 'From the shop'
  const categories =
    kind === 'makeup'
      ? []
      : [...(wearable.length ? [SHOP] : []), ...new Set(templates.map((t) => t.category_name))]
  const shown =
    kind === 'makeup'
      ? wearable.map((p) => ({
          id: p.id,
          thumb: p.image ?? '',
          title: p.name,
          category_name: 'makeup',
          hex: p.hex,
        }))
      : category === SHOP
      ? wearable.map((p) => ({
          id: p.id,
          thumb: p.image!,
          title: p.name,
          category_name: SHOP,
        }))
      : templates.filter((t) => t.category_name === category)

  const apply = async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      // A shop garment goes through the product route, which resolves the
      // image by id server-side; a built-in style goes through templates.
      const isProduct = wearable.some((p) => p.id === selected)
      const endpoint =
        kind === 'makeup'
          ? '/api/tryon/makeup'
          : kind === 'hair'
            ? '/api/tryon/hair'
            : isProduct
              ? '/api/tryon/cloth'
              : '/api/tryon/cloth-template'

      const chosen = wearable.find((p) => p.id === selected)
      const payload =
        kind === 'makeup'
          ? {
              fileId,
              // The prescribed intensities travel with the swatch, so the
              // render is her formula in this shade, not a preset.
              effects: (makeupEffects ?? []).map((e: any) =>
                e.category === effectCategory
                  ? { ...e, palettes: [{ ...e.palettes[0], color: chosen?.hex }] }
                  : e,
              ),
            }
          : isProduct
            ? { modelFileId: fileId, garmentId: selected }
            : { fileId, templateId: selected }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Try-on failed.')
      setResult(body.url)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="studio">
      {/* Rail: styles stay docked so the canvas never moves. */}
      <aside className="rail">
        <h3 className="rail-title">
          {kind === 'cloth' ? 'Select a style' : 'Select a cut'}
        </h3>
        <p className="tiny">
          {kind === 'cloth'
            ? 'Rendered on your photo by YouCam.'
            : 'YouCam renders the cut on your own hair.'}
        </p>

        {categories.length > 1 && (
          <div className="rail-tabs" role="tablist">
            {categories.map((c) => (
              <button
                key={c}
                role="tab"
                aria-selected={category === c}
                className={category === c ? 'rail-tab on' : 'rail-tab'}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        <div className="rail-grid">
          {shown.map((t) => (
            <button
              key={t.id}
              className={selected === t.id ? 'thumb-btn on' : 'thumb-btn'}
              aria-pressed={selected === t.id}
              onClick={() => setSelected(t.id)}
            >
              {t.thumb ? (
                <img src={t.thumb} alt="" loading="lazy" />
              ) : (
                // A shade has no photo worth showing: the colour is the product.
                <span className="thumb-swatch" style={{ background: (t as any).hex }} />
              )}
              <span className="thumb-title">{t.title}</span>
            </button>
          ))}
          {templates.length === 0 && !error && (
            <>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="skeleton thumb-skel" />
              ))}
            </>
          )}
        </div>

        <button className="btn" onClick={apply} disabled={!selected || busy}>
          {busy ? 'Rendering…' : result ? 'Apply again' : 'Apply'}
        </button>
      </aside>

      {/* Canvas: the one thing that must not move. */}
      <div className="canvas">
        {busy && <div className="skeleton canvas-fill" />}
        {!busy && (result || photo) && (
          <img
            className={result ? 'canvas-fill rise' : 'canvas-fill'}
            src={result ?? photo!}
            alt={result ? 'Your try-on' : 'Your photo'}
          />
        )}
        {!busy && !result && !photo && (
          <div className="canvas-empty">
            <p className="tiny">Your photo appears here.</p>
          </div>
        )}

        {result && (
          <span className="canvas-tag">Rendered by YouCam {kind === 'cloth' ? 'AI Clothes' : 'Hair'}</span>
        )}

        {error && (
          <p className="notice notice-error canvas-msg" role="alert">
            {error}
          </p>
        )}
        {formulaNote && !error && <p className="canvas-note tiny">{formulaNote}</p>}
      </div>
    </div>
  )
}
