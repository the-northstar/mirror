/**
 * Mirror embed widget.
 *
 * One script tag on a retailer's site. Opens Mirror in an overlay, scans the
 * shopper, and recommends that retailer's own catalogue:
 *
 *   <script src="https://mirror.pykero.com/sdk/mirror.js"
 *           data-store="store-acme-1" defer></script>
 *
 * A thin layer over the headless client — it owns the overlay and the button,
 * nothing else. Anything it can do, createMirror() can do without the UI.
 */
import { createMirror } from './client'

interface EmbedOptions {
  storeId: string
  baseUrl?: string
  /** Inline catalogue: skips any hosted feed, for small or demo shelves. */
  products?: unknown[]
  /** Text on the launcher. Omit to use the default. */
  label?: string
  /** Attach to this element instead of injecting a floating button. */
  target?: string
}

const STYLE = `
.mirror-fab{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:inline-flex;
align-items:center;gap:8px;padding:12px 20px;border:0;border-radius:999px;
background:#1f4d38;color:#fff;font:500 15px/1 ui-sans-serif,system-ui,sans-serif;
box-shadow:0 6px 24px rgb(0 0 0/.18);cursor:pointer}
.mirror-fab:hover{background:#173a2b}
.mirror-overlay{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;
justify-content:center;background:rgb(20 18 16/.55);backdrop-filter:blur(4px)}
.mirror-panel{position:relative;width:min(920px,94vw);height:min(760px,92vh);
background:#fbfaf7;border-radius:16px;overflow:hidden;box-shadow:0 24px 80px rgb(0 0 0/.35)}
.mirror-frame{width:100%;height:100%;border:0;display:block}
.mirror-x{position:absolute;top:12px;right:12px;z-index:2;width:34px;height:34px;
border:0;border-radius:50%;background:rgb(255 255 255/.92);color:#161a17;font-size:20px;
line-height:1;cursor:pointer;box-shadow:0 2px 8px rgb(0 0 0/.15)}
@media (prefers-reduced-motion:no-preference){.mirror-overlay{animation:mirror-in .2s ease}}
@keyframes mirror-in{from{opacity:0}to{opacity:1}}
`.trim()

export function mount(options: EmbedOptions) {
  const base = (options.baseUrl ?? 'https://mirror.pykero.com').replace(/\/$/, '')
  const mirror = createMirror({ storeId: options.storeId, baseUrl: base })

  // An inline catalogue is pushed once on mount, so the shelf is ready before
  // the shopper opens the overlay. This runs in the browser, so it uses the
  // keyless store route — the secret key must never reach a page.
  if (options.products?.length) {
    void fetch(`${base}/api/stores/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: options.storeId, products: options.products }),
    }).catch(() => {
      // A failed preload must not stop the widget: the hosted shelf still works.
    })
  }

  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  let overlay: HTMLDivElement | null = null

  function open() {
    if (overlay) return
    overlay = document.createElement('div')
    overlay.className = 'mirror-overlay'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-label', 'Mirror — find what suits you')

    const panel = document.createElement('div')
    panel.className = 'mirror-panel'

    const close = document.createElement('button')
    close.className = 'mirror-x'
    close.type = 'button'
    close.setAttribute('aria-label', 'Close Mirror')
    close.textContent = '×'
    close.onclick = shut

    // An iframe rather than injected markup: the retailer's CSS cannot reach
    // in and break the scan, and our styles cannot leak onto their page.
    const frame = document.createElement('iframe')
    frame.className = 'mirror-frame'
    frame.title = 'Mirror'
    frame.allow = 'camera; clipboard-write'
    frame.src = `${base}/?embed=1&storeId=${encodeURIComponent(options.storeId)}`

    panel.append(close, frame)
    overlay.appendChild(panel)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) shut()
    })
    document.addEventListener('keydown', onKey)
    document.body.appendChild(overlay)
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') shut()
  }

  function shut() {
    overlay?.remove()
    overlay = null
    document.removeEventListener('keydown', onKey)
  }

  if (options.target) {
    document.querySelector(options.target)?.addEventListener('click', open)
  } else {
    const fab = document.createElement('button')
    fab.className = 'mirror-fab'
    fab.type = 'button'
    fab.textContent = options.label ?? 'Find what suits me'
    fab.onclick = open
    document.body.appendChild(fab)
  }

  return { open, close: shut, mirror }
}

/** Auto-mount from the script tag's own data attributes. */
function boot() {
  const tag = document.currentScript as HTMLScriptElement | null
  const el =
    tag ?? (document.querySelector('script[data-store]') as HTMLScriptElement | null)
  const storeId = el?.dataset.store
  if (!storeId) return

  const start = () =>
    mount({
      storeId,
      baseUrl: el?.dataset.base,
      label: el?.dataset.label,
      target: el?.dataset.target,
    })

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else start()
}

// Exposed for manual control; also boots itself from the tag.
;(window as unknown as { Mirror: { mount: typeof mount } }).Mirror = { mount }
boot()
