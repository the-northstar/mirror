import { expect, test } from 'bun:test'
import { normalizeProduct, parseCsv, rowsToProducts, summariseOrders } from './products.ts'

const OK = {
  name: 'Petrol Overshirt',
  brand: 'Kotn',
  aisle: 'clothes',
  hex: '#2F5D62',
  image: 'https://cdn.example.com/shirt.png',
  price: '89',
}

test('a valid product is normalised and owner-scoped', () => {
  const p = normalizeProduct(OK, 'user_2abcdefgh')
  expect(p.id).toBe('own-abcdefgh-petrol-overshirt')
  expect(p.hex).toBe('#2f5d62')
  expect(p.aisle).toBe('clothes')
  expect(p.price).toBe(89)
  expect(p.ownerId).toBe('user_2abcdefgh')
  // Without a storeId the row is visible in the shop but silently unorderable.
  expect(p.storeId).toBe('own-abcdefgh')
  // The ranker matches on hex, but the shop prints the name.
  expect(p.colorName).toBeTruthy()
})

test('rejects rows the shop cannot rank or render', () => {
  expect(() => normalizeProduct({ ...OK, name: '  ' }, 'u')).toThrow()
  expect(() => normalizeProduct({ ...OK, hex: 'petrol' }, 'u')).toThrow()
  // http and relative URLs are unreachable to YouCam's fetchers.
  expect(() => normalizeProduct({ ...OK, image: 'http://a.test/x.png' }, 'u')).toThrow()
  expect(() => normalizeProduct({ ...OK, image: '/garments/x.png' }, 'u')).toThrow()
  expect(() => normalizeProduct({ ...OK, aisle: 'hats' }, 'u')).toThrow()
  expect(() => normalizeProduct({ ...OK, price: 'free' }, 'u')).toThrow()
  expect(() => normalizeProduct(null, 'u')).toThrow()
})

test('optional fields stay optional', () => {
  const p = normalizeProduct({ name: 'X', hex: '#2f5d62', image: 'https://a.test/x.png' }, 'u')
  expect(p.aisle).toBe('clothes')
  expect(p.brand).toBe('Your store')
  expect(p.price).toBeUndefined()
  expect(p.url).toBeUndefined()
})

test('a spreadsheet imports row by row, reporting only the bad lines', () => {
  const { products, errors } = rowsToProducts(
    [
      ['Name', 'Brand', 'Aisle', 'Hex', 'Image', 'Price'],
      ['Sage knit', 'Kotn', 'clothes', '#8a9a7b', 'https://a.test/1.png', '70'],
      ['Broken', 'Kotn', 'clothes', 'not-a-hex', 'https://a.test/2.png', ''],
      [],
      ['Camel coat', '', 'clothes', '#b08d57', 'https://a.test/3.png', ''],
    ],
    'user_2abcdefgh',
  )
  expect(products.map((p) => p.name)).toEqual(['Sage knit', 'Camel coat'])
  expect(errors).toHaveLength(1)
  // Line numbers must match what the owner sees in Excel: blanks are skipped,
  // so the bad row is 3 of the compacted sheet.
  expect(errors[0]).toStartWith('Row 3:')
})

test('columns are matched by name, not position', () => {
  const { products } = rowsToProducts(
    [
      ['Image', 'Hex', 'Name'],
      ['https://a.test/1.png', '#8a9a7b', 'Sage knit'],
    ],
    'u',
  )
  expect(products[0].name).toBe('Sage knit')
  expect(products[0].image).toBe('https://a.test/1.png')
})

test('a sheet missing required columns is refused whole', () => {
  const { products, errors } = rowsToProducts([['Name', 'Price'], ['X', '9']], 'u')
  expect(products).toHaveLength(0)
  expect(errors[0]).toContain('hex and image')
})

test('csv parsing survives quotes, commas and newlines in fields', () => {
  expect(parseCsv('name,hex\r\n"Knit, ribbed",#8a9a7b\n')).toEqual([
    ['name', 'hex'],
    ['Knit, ribbed', '#8a9a7b'],
  ])
  expect(parseCsv('a\n"say ""hi""","two\nlines"')).toEqual([
    ['a'],
    ['say "hi"', 'two\nlines'],
  ])
})

test('the books roll up per product, best seller first', () => {
  const line = (id: string, name: string, qty: number, unitPrice: number) => ({
    product: { id, name } as never,
    qty,
    unitPrice,
  })
  const f = summariseOrders([
    { id: 'o1', at: 1, storeId: 's', total: 0, lines: [line('a', 'Shirt', 2, 10), line('b', 'Coat', 1, 60)] },
    { id: 'o2', at: 2, storeId: 's', total: 0, lines: [line('a', 'Shirt', 3, 10)] },
  ] as never)

  expect(f.orders).toBe(2)
  expect(f.units).toBe(6)
  expect(f.revenue).toBe(110)
  // Coat outsells Shirt by revenue despite fewer units — that is the ordering.
  expect(f.byProduct.map((p) => [p.name, p.units, p.revenue])).toEqual([
    ['Coat', 1, 60],
    ['Shirt', 5, 50],
  ])
})

test('no orders is zero, not a crash or a NaN', () => {
  expect(summariseOrders([])).toEqual({ revenue: 0, orders: 0, units: 0, byProduct: [] })
})
