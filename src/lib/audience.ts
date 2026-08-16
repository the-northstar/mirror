/**
 * Who the shelf is for.
 *
 * Kept out of the server route so it can be tested without standing a server
 * up, and so the browser and the SDK read the same rules the API applies.
 */

/**
 * 'everything' is a real answer, not the absence of one: it is what a shopper
 * who does not want the shelf split by gender picks, and what we fall back to
 * when nothing was declared or detected.
 */
export type ShoppingFor = 'women' | 'men' | 'everything'

/**
 * The shopper's own answer wins; detection only fills in when they gave none.
 *
 * YouCam's age/gender read is good enough to PRESELECT a control and nowhere
 * near good enough to hide an aisle on its own. That asymmetry is the whole
 * rule: a wrong guess the shopper can see and change costs a tap, while a
 * wrong guess acting silently removes products they came for and tells them
 * the shop simply does not stock their half of it.
 */
export function shoppingFor(declared?: string, detected?: string): ShoppingFor {
  const said = declared?.toLowerCase()
  if (said === 'women' || said === 'men' || said === 'everything') return said
  // 'other', or anything we do not recognise, means the shopper declined to
  // split the shelf. That is 'everything' — and never a cue to quietly fall
  // back on the detector, which would overrule the answer they just gave.
  if (said) return 'everything'

  const read = detected?.toLowerCase()
  if (read === 'female') return 'women'
  if (read === 'male') return 'men'
  return 'everything'
}

/**
 * Keep a product on the shelf?
 *
 * Unset audience means unisex, and unisex suits everyone: most of the
 * catalogue — every foundation, every serum — carries no audience at all, and
 * defaulting those to "hide" would empty the shop. Only rows a merchant or a
 * feed explicitly cut for one audience are filtered.
 */
export function suitsAudience(p: { audience?: string }, wants: ShoppingFor): boolean {
  if (wants === 'everything') return true
  if (!p.audience || p.audience === 'unisex') return true
  return p.audience === wants
}

/**
 * YouCam's own hair categories are literally "Male" and "Female".
 *
 * So this reads a label rather than inferring one, which is why hair can be
 * filtered as confidently as a feed's menswear path — and why anything else,
 * including a category YouCam adds later, falls through to unisex rather than
 * being guessed at from its name.
 */
export function audienceOfCategory(category?: string): 'women' | 'men' | 'unisex' {
  const c = category?.trim().toLowerCase()
  if (c === 'male' || c === 'men' || c === "men's") return 'men'
  if (c === 'female' || c === 'women' || c === "women's") return 'women'
  return 'unisex'
}

/**
 * Keep the two sets in blocks instead of shuffling them together.
 *
 * Used where nothing is being filtered — a shopper who asked for 'everything'
 * gets every style — but an interleaved shelf still makes them scroll past
 * alternating men's and women's cuts to see either set whole. Unisex rows go
 * last rather than in either block, because they belong to both.
 *
 * `lead` is the scan's guess, which is the right weight for it: deciding which
 * block comes first is a reversible convenience, and a wrong guess costs a
 * scroll rather than a missing aisle.
 */
export function groupByAudience<T extends { audience?: string }>(
  rows: T[],
  lead?: string,
): T[] {
  const first = lead?.toLowerCase() === 'male' ? 'men' : lead?.toLowerCase() === 'female' ? 'women' : null
  if (!first) return rows
  const rank = (r: T) => (r.audience === first ? 0 : !r.audience || r.audience === 'unisex' ? 2 : 1)
  // Stable: within a block the catalogue's own order survives, so this
  // regroups the shelf without silently re-ranking it.
  return [...rows].sort((a, b) => rank(a) - rank(b))
}

/**
 * Colour cosmetics are not filtered by audience — they are folded away.
 *
 * There is no such thing as a men's lipstick row to filter on, so the choice
 * would be between showing a man the whole women's shelf and claiming the
 * catalogue holds nothing for him. Neither is true. Instead the aisles ship
 * complete and ranked, and the UI keeps them closed until he opens them: a
 * request he makes, not a rule about who is allowed to wear what.
 * */
export function gatedAisles(wants: ShoppingFor): string[] {
  return wants === 'men' ? ['lipstick', 'blush'] : []
}
