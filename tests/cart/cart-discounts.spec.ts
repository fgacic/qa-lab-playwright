import { CART_MESSAGES as MESSAGES } from '@components/CartTable';
import { expect, mock, test, withMocks } from '@fixtures';
import { CART } from '@support/cart-routes';

/** The mocked products of the discount specs, named once: the cart is built from them and its rows are found by them. */
const ECO_SAW = 'QA Lab Eco Saw';
const RENTAL_DRILL = 'QA Lab Rental Drill';
const HAMMER = 'QA Lab Hammer';

/**
 * A cart with fixed prices, answered by a mock, for the discount specs. The expected figures are
 * written out (5% of 80.00 is 4.00, 15% of 80.00 is 12.00) and not computed with the app's own rule.
 * The 15% combination discount is the cart's own `additional_discount_percentage`; the page
 * turns it into an amount, which is what is checked there.
 */
const cartOf = (items: { name: string; price: number; quantity: number; eco?: boolean; rental?: boolean }[], additionalDiscountPercentage: number | null = null) =>
  mock.respond('GET', CART, {
    id: 'qa-lab',
    additional_discount_percentage: additionalDiscountPercentage,
    lat: null,
    lng: null,
    cart_items: items.map((item, i) => ({
      id: `qa-lab-line-${i}`,
      quantity: item.quantity,
      discount_percentage: null,
      cart_id: 'qa-lab',
      product_id: `qa-lab-product-${i}`,
      product: {
        id: `qa-lab-product-${i}`,
        name: item.name,
        description: 'A product with a fixed price.',
        price: item.price,
        is_location_offer: !!item.rental,
        is_rental: !!item.rental,
        co2_rating: item.eco ? 'A' : 'D',
        in_stock: true,
        is_eco_friendly: !!item.eco,
      },
    })),
  });

/** The discount rules of the cart page, on a cart with fixed prices (the shop's own carts hold whatever the seed sells). */
test.describe('Cart discounts', () => {
  test.describe('with only an eco-friendly product', { tag: ['@mocked'] }, () => {
    test.use(withMocks(cartOf([{ name: ECO_SAW, price: 80, quantity: 1, eco: true }])));

    test('a 5% eco-friendly discount comes off the subtotal', async ({ checkout }) => {
      const { table } = checkout.cart;

      await expect(table.subtotal).toShowAmount(80);
      await expect(table.ecoDiscount).toShowAmount(-4);
      await expect(table.total).toShowAmount(76);
    });
  });

  test.describe('with a rental and a product', { tag: ['@mocked'] }, () => {
    test.use(withMocks(cartOf([{ name: RENTAL_DRILL, price: 50, quantity: 1, rental: true }, { name: HAMMER, price: 30, quantity: 1 }], 15)));

    test('a 15% combination discount applies and the rental is priced per hour', async ({ checkout }) => {
      const { table } = checkout.cart;

      await expect(table.row(RENTAL_DRILL).root).toContainText(MESSAGES.rentalPerHour);
      await expect(table.subtotal).toShowAmount(80);
      await expect(table.discount).toShowAmount(-12);
      await expect(table.total).toShowAmount(68);
    });
  });

  /**
   * The cases around the two rules, as figures written out by hand: what stands alone, what stacks, and what is absent. A cart with no
   * discount shows its total row only (the subtotal row appears only beside a discount), which is why `subtotal` is absent there. A cart that
   * mixes an eco-friendly product with another kind gets no eco discount on this page; whether that is intended is unclear (docs/COVERAGE.md
   * lists it as a gap), so no case here asserts the eco figure of a mixed cart, only that the combination discount the API did not send is absent.
   */
  type Row = 'subtotal' | 'discount' | 'ecoDiscount' | 'total';
  const CASES: { title: string; items: Parameters<typeof cartOf>[0]; percentage: number | null; amounts: Partial<Record<Row, number>>; absent: Row[] }[] = [
    {
      title: 'a rental on its own gets no discount',
      items: [{ name: RENTAL_DRILL, price: 50, quantity: 1, rental: true }],
      percentage: null,
      amounts: { total: 50 },
      absent: ['subtotal', 'ecoDiscount', 'discount'],
    },
    {
      title: 'an eco-friendly discount applies to every unit of a multi-quantity line',
      items: [{ name: ECO_SAW, price: 80, quantity: 3, eco: true }],
      percentage: null,
      amounts: { subtotal: 240, ecoDiscount: -12, total: 228 },
      absent: ['discount'],
    },
    {
      title: 'an eco-friendly product and a rental get no combination discount unless the API sends one',
      items: [{ name: ECO_SAW, price: 80, quantity: 1, eco: true }, { name: RENTAL_DRILL, price: 50, quantity: 1, rental: true }],
      percentage: null,
      amounts: {},
      absent: ['discount'],
    },
    {
      title: 'a cart with nothing eligible shows no discount row at all',
      items: [{ name: HAMMER, price: 30, quantity: 1 }],
      percentage: 0,
      amounts: { total: 30 },
      absent: ['subtotal', 'ecoDiscount', 'discount'],
    },
  ];

  for (const { title, items, percentage, amounts, absent } of CASES) {
    test.describe(title, { tag: ['@mocked'] }, () => {
      test.use(withMocks(cartOf(items, percentage)));

      test('the cart totals follow the rules', async ({ checkout }) => {
        const { table } = checkout.cart;

        // The cart must have drawn before an absent row means anything.
        for (const { name } of items) await expect(table.row(name).root, `the line of ${name}`).toBeVisible();
        for (const [row, amount] of (Object.entries(amounts) as [Row, number][])) await expect(table[row], `the ${row} row`).toShowAmount(amount);
        for (const row of absent) await expect(table[row], `no ${row} row`).toHaveCount(0);
      });
    });
  }
});
