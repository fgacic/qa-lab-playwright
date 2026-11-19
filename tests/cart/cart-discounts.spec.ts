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
test.describe('Cart', () => {
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
});
