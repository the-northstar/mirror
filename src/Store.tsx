/**
 * Store owner side of the app.
 *
 * Shoppers stay anonymous; only the retailer signs in, and only to stock the
 * shelves their customers are prescribed from. Auth is Clerk — the session
 * token goes to /api/products, which decides ownership from the token alone.
 *
 * Two ways in, because a store with three products and a store with three
 * hundred are different problems: a form for one, a spreadsheet for the rest.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  SignedIn,
  SignedOut,
  SignIn,
  UserButton,
  useAuth,
  useUser,
} from '@clerk/clerk-react'
import { AISLES, COLUMNS, type OwnerProduct } from './lib/products'
import { CLERK_KEY } from './lib/clerk'

type Row = {
  name: string
  brand: string
  aisle: string
  hex: string
  image: string
  price: string
}

const BLANK: Row = {
  name: '',
  brand: '',
  aisle: 'clothes',
  hex: '#2f5d62',
  image: '',
  price: '',
}

type Listed = Omit<OwnerProduct, 'ownerId'> & { mine?: boolean }

export default function Store() {
  // The hooks live in Owner, so a missing key never renders them at all.
  if (!CLERK_KEY) return <SetupNote />

  return (
    <>
      <SignedOut>
        <main className="wrap stack">
          <h1 className="display">Store owner</h1>
          <p className="lead">
            Sign in to stock the shelves your customers are prescribed from.
          </p>
          <SignIn routing="virtual" />
        </main>
      </SignedOut>
      <SignedIn>
        <Owner />
      </SignedIn>
    </>
  )
}

function Owner() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const [listed, setListed] = useState<Listed[]>([])
  /** One row per product. A single row is the ordinary "add one" case. */
  const [rows, setRows] = useState<Row[]>([BLANK])
  const [rowErrors, setRowErrors] = useState<(string | null)[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imported, setImported] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const call = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const token = await getToken()
      if (!token) throw new Error('Your session expired. Sign in again.')
      const res = await fetch(path, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status}).`)
      return body
    },
    [getToken],
  )

  const refresh = useCallback(async () => {
    try {
      const { products } = await call('/api/products')
      setListed(products)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [call])

  useEffect(() => {
    refresh()
  }, [refresh])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setImported(null)
    const errors: (string | null)[] = rows.map(() => null)
    try {
      // Sequential on purpose: the catalogue is one JSON file, so concurrent
      // writes would read-modify-write over each other.
      for (const [i, row] of rows.entries()) {
        try {
          await call('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(row),
          })
        } catch (err) {
          errors[i] = (err as Error).message
        }
      }
    } catch (err) {
      setError((err as Error).message)
    }
    // Keep only the rows that failed, with their reason attached.
    const failed = rows.filter((_, i) => errors[i])
    setRows(failed.length ? failed : [BLANK])
    setRowErrors(errors.filter(Boolean))
    setBusy(false)
    await refresh()
  }

  const importSheet = async (file: File) => {
    setBusy(true)
    setError(null)
    setImported(null)
    try {
      const form = new FormData()
      form.append('sheet', file)
      const { added, errors } = await call('/api/products/import', {
        method: 'POST',
        body: form,
      })
      setImported(
        `${added} product${added === 1 ? '' : 's'} imported from ${file.name}.`,
      )
      setRowErrors(errors)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setError(null)
    try {
      await call(`/api/products?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const set = <K extends keyof Row>(i: number, k: K, v: Row[K]) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))

  const mine = listed.filter((p) => p.mine)

  return (
    <main className="wrap stack">
      <section className="owner-head">
        <div>
          <h1 className="display">Your store</h1>
          <p className="tiny">
            Signed in as {user?.primaryEmailAddress?.emailAddress}
          </p>
        </div>
        <UserButton />
      </section>

      <section className="card stack">
        <h3>Import a spreadsheet</h3>
        <p className="tiny">
          An .xlsx or .csv with a header row. Columns: {COLUMNS.join(', ')} —
          <strong> name</strong>, <strong>hex</strong> and <strong>image</strong>{' '}
          are required, the rest optional. Order does not matter.
        </p>
        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Choose file
          </button>
          <a className="btn btn-quiet" href={templateHref()} download="products.csv">
            Download template
          </a>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importSheet(f)
            e.target.value = ''
          }}
        />
        {imported && <p className="notice">{imported}</p>}
      </section>

      <form className="stack" onSubmit={submit}>
        {rows.map((row, i) => (
          <fieldset key={i} className="card stack form">
            <legend className="row-head">
              <h3>Add one{rows.length > 1 ? ` (${i + 1})` : ''}</h3>
              {rows.length > 1 && (
                <button
                  type="button"
                  className="textlink"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                >
                  Remove row
                </button>
              )}
            </legend>

            <div className="field-grid">
              <label>
                Name
                <input
                  value={row.name}
                  onChange={(e) => set(i, 'name', e.target.value)}
                  placeholder="Petrol overshirt"
                  required
                />
              </label>

              <label>
                Brand
                <input
                  value={row.brand}
                  onChange={(e) => set(i, 'brand', e.target.value)}
                  placeholder="Your store"
                />
              </label>

              <label>
                Aisle
                <select
                  value={row.aisle}
                  onChange={(e) => set(i, 'aisle', e.target.value)}
                >
                  {AISLES.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Price
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.price}
                  onChange={(e) => set(i, 'price', e.target.value)}
                  placeholder="89"
                />
              </label>

              <label className="span-2">
                Image URL
                <input
                  type="url"
                  value={row.image}
                  onChange={(e) => set(i, 'image', e.target.value)}
                  placeholder="https://cdn.yourshop.com/overshirt.png"
                  required
                />
                <span className="tiny">
                  Public https link. Try-on fetches it from YouCam's servers, so
                  it cannot be a local file.
                </span>
              </label>

              <label className="span-2">
                Colour
                <span className="colorrow">
                  <input
                    type="color"
                    value={row.hex}
                    onChange={(e) => set(i, 'hex', e.target.value)}
                  />
                  <span className="tiny">
                    What the shopper's palette is matched against. Rows without a
                    colour cannot be ranked.
                  </span>
                </span>
              </label>
            </div>

            {rowErrors[i] && (
              <p className="notice notice-error" role="alert">
                {rowErrors[i]}
              </p>
            )}
          </fieldset>
        ))}

        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {rowErrors.length > rows.length &&
          rowErrors.slice(rows.length).map((m) => (
            <p key={m} className="notice notice-error" role="alert">
              {m}
            </p>
          ))}

        <div className="actions">
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => setRows((rs) => [...rs, BLANK])}
          >
            + Another
          </button>
          <button className="btn" disabled={busy}>
            {busy ? 'Saving…' : rows.length > 1 ? `Add ${rows.length}` : 'Add product'}
          </button>
        </div>
      </form>

      <section className="stack">
        <h3>On your shelves ({mine.length})</h3>
        {mine.length === 0 ? (
          <p className="tiny">
            Nothing yet. Add one above, or import a spreadsheet.
          </p>
        ) : (
          <div className="grid">
            {mine.map((p) => (
              <figure key={p.id} className="tile">
                <img src={p.image} alt="" loading="lazy" />
                <figcaption>
                  <strong>{p.name}</strong>
                  <span className="tiny">
                    <i className="dot" style={{ background: p.hex }} />
                    {p.colorName} · {p.aisle}
                    {p.price ? ` · $${p.price}` : ''}
                  </span>
                  <button className="textlink" onClick={() => remove(p.id)}>
                    Remove
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

/** The template is the column list itself, so it cannot drift from the parser. */
function templateHref(): string {
  const example = [
    'Petrol overshirt',
    'Your store',
    'clothes',
    '#2f5d62',
    'https://cdn.yourshop.com/overshirt.png',
    '89',
    'https://yourshop.com/overshirt',
  ]
  const csv = `${COLUMNS.join(',')}\n${example.join(',')}\n`
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
}

function SetupNote() {
  return (
    <main className="wrap stack">
      <div className="card">
        <h2>Store sign-in is not configured</h2>
        <p className="tiny">
          Add <code>VITE_CLERK_PUBLISHABLE_KEY</code> and{' '}
          <code>CLERK_SECRET_KEY</code> to <code>.env</code> from your Clerk
          dashboard, then rebuild. Shoppers can use the rest of the app without
          it.
        </p>
      </div>
    </main>
  )
}
