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

export type StudioKind = 'cloth' | 'hair'

export function Studio({
  kind,
  fileId,
  photo,
  formulaNote,
}: {
  kind: StudioKind
  fileId: string
  photo: string | null
  /** Shown under the canvas so the render still cites the scan that drove it. */
  formulaNote?: string
}) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [category, setCategory] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/${kind}/templates`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return
        const rows: Template[] = d.templates ?? []
        setTemplates(rows)
        setCategory(rows[0]?.category_name ?? null)
      })
      .catch(() => live && setError('Could not load styles.'))
    return () => {
      live = false
    }
  }, [kind])

  const categories = [...new Set(templates.map((t) => t.category_name))]
  const shown = templates.filter((t) => t.category_name === category)

  const apply = async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/tryon/${kind === 'cloth' ? 'cloth-template' : 'hair'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, templateId: selected }),
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
              <img src={t.thumb} alt="" loading="lazy" />
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
