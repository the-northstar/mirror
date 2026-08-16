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
import {
  AISLES,
  COLUMNS,
  GARMENT_CATEGORIES,
  type Finance,
  type OwnerProduct,
} from './lib/products'
import type { Order } from './lib/catalogue'
import { CLERK_KEY } from './lib/clerk'

type Row = {
  name: string
  brand: string
  aisle: string
  hex: string
  price: string
  garmentCategory: string
  /** The chosen file, and a blob URL for the preview. */
  photo: File | null
  preview: string
}

const BLANK: Row = {
  name: '',
  brand: '',
  aisle: 'clothes',
  hex: '#2f5d62',
  price: '',
  garmentCategory: 'auto',
  photo: null,
  preview: '',
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
  const [orders, setOrders] = useState<Order[]>([])
  const [finance, setFinance] = useState<Finance | null>(null)
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
    // The books are a separate read: a failure there must not blank the
    // catalogue the owner came here to manage.
    try {
      const books = await call('/api/products/orders')
      setOrders(books.orders)
      setFinance(books.finance)
    } catch {
      /* leave the last figures on screen */
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
          const form = new FormData()
          for (const [k, v] of Object.entries(row)) {
            if (k === 'photo' || k === 'preview' || typeof v !== 'string') continue
            form.append(k, v)
          }
          if (row.photo) form.append('photo', row.photo)
          await call('/api/products', { method: 'POST', body: form })
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

              {row.aisle === 'clothes' && (
                <label>
                  Worn as
                  <select
                    value={row.garmentCategory}
                    onChange={(e) => set(i, 'garmentCategory', e.target.value)}
                  >
                    {GARMENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                  <span className="tiny">
                    Guessed from the photo unless you say. A dress set to a top
                    renders as a top.
                  </span>
                </label>
              )}

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
                Photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null
                    if (row.preview) URL.revokeObjectURL(row.preview)
                    set(i, 'photo', f)
                    set(i, 'preview', f ? URL.createObjectURL(f) : '')
                  }}
                />
                <span className="tiny">
                  A flat-lay on white renders best. Uploaded here, then served
                  from this site so YouCam can fetch it.
                </span>
                {row.preview && (
                  <img className="photo-preview" src={row.preview} alt="" />
                )}
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
        <h3>Sales</h3>
        {!finance || finance.orders === 0 ? (
          <p className="tiny">
            No orders yet. They appear here the moment a shopper checks out.
          </p>
        ) : (
          <>
            <div className="books">
              <div className="figure">
                <strong>{money(finance.revenue)}</strong>
                <span className="tiny">Revenue</span>
              </div>
              <div className="figure">
                <strong>{finance.orders}</strong>
                <span className="tiny">Order{finance.orders === 1 ? '' : 's'}</span>
              </div>
              <div className="figure">
                <strong>{finance.units}</strong>
                <span className="tiny">Item{finance.units === 1 ? '' : 's'} sold</span>
              </div>
              <div className="figure">
                <strong>{money(finance.revenue / finance.orders)}</strong>
                <span className="tiny">Average order</span>
              </div>
            </div>

            <table className="ledger">
              <caption className="tiny">
                Best seller first. Revenue is what was charged at the time, not
                today's price.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Units</th>
                  <th scope="col">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {finance.byProduct.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.units}</td>
                    <td>{money(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h4>Recent orders</h4>
            <ul className="orders">
              {[...orders]
                .sort((a, b) => b.at - a.at)
                .slice(0, 10)
                .map((o) => (
                  <li key={o.id} className="card order">
                    <div className="order-head">
                      <strong>{o.id}</strong>
                      <span className="tiny">{new Date(o.at).toLocaleString()}</span>
                      <span className="order-total">{money(o.total)}</span>
                    </div>
                    <ul className="tiny">
                      {o.lines.map((l) => (
                        <li key={l.product.id}>
                          {l.qty} × {l.product.name} @ {money(l.unitPrice)}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
            </ul>
          </>
        )}
      </section>

      <section className="stack">
        <h3>On your shelves ({mine.length})</h3>
        {mine.length === 0 ? (
          <p className="tiny">
            Nothing yet. Add one above, or import a spreadsheet.
          </p>
        ) : (
          <div className="tile-grid">
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

const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })

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
