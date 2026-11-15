import { CHECKOUT_STEPS } from '@components/checkout/StepIndicator';
import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';

/** What the shop tells the shopper, word for word. */
const MESSAGES = {
  quantityUpdated: 'Product quantity updated.',
  lineDeleted: 'Product deleted.',
  atMost99: 'You can order at most 99 of this product.',
  serverError: 'Server Error',
} as const;

/** Every cart here is created through the API, so each test starts from a known cart. */
test.describe('Cart', () => {
  test.describe('with two different products', () => {
    test.use({
      cartItems: async ({ catalog }, use) =>
        use([
          { product: await catalog.inStock(), quantity: 2 },
          { product: await catalog.anotherInStock(), quantity: 1 },
        ]),
    });

    test('lists each line with its quantity, price and line total, and the cart total', { tag: ['@smoke'] }, async ({ checkout, cartItems }) => {
      const { table } = checkout.cart;
      await expect(table.rows).toHaveCount(2);

      for (const { product, quantity } of cartItems) {
        const row = table.row(product.name);
        await expect(row.quantity).toHaveValue(String(quantity));
        await expect(row.unitPrice).toShowAmount(product.price);
        await expect(row.linePrice).toShowAmount(product.price * quantity);
      }
      await expect(table.total).toShowAmount(cartItems.reduce((sum, i) => sum + i.product.price * i.quantity, 0));
      await expect(checkout.header.cartLink).toHaveText('3');
    });

    test('changing a quantity updates the line, the total and the header count', async ({ checkout, cartItems }) => {
      const [first, second] = cartItems;

      await checkout.cart.table.setQuantity(first.product.name, 4);

      await expect(checkout.toast.message(MESSAGES.quantityUpdated)).toBeVisible();
      await expect(checkout.cart.table.row(first.product.name).linePrice).toShowAmount(first.product.price * 4);
      await expect(checkout.cart.table.total).toShowAmount(first.product.price * 4 + second.product.price);
      await expect(checkout.header.cartLink).toHaveText('5');
    });

    test('removing a line drops it from the cart and the total', async ({ checkout, cartItems }) => {
      const [first, second] = cartItems;

      await checkout.cart.table.remove(first.product.name);

      await expect(checkout.toast.message(MESSAGES.lineDeleted)).toBeVisible();
      await expect(checkout.cart.table.rows).toHaveCount(1);
      await expect(checkout.cart.table.row(second.product.name).title).toBeVisible();
      await expect(checkout.cart.table.total).toShowAmount(second.product.price);
    });
  });

  test('a quantity of 0 is corrected to 1, also in the saved cart', { tag: ['@negative'] }, async ({ checkout, cartItems, apiMock }) => {
    const [{ product }] = cartItems;

    const [saved] = await Promise.all([
      apiMock.waitForResponse('PUT', /^\/carts\/[^/]+\/product\/quantity$/),
      checkout.cart.table.setQuantity(product.name, 0),
    ]);

    expect(saved.response.status()).toBe(200);
    await expect(checkout.cart.table.row(product.name).quantity).toHaveValue('1');
    await checkout.page.reload();
    await expect(checkout.cart.table.row(product.name).quantity).toHaveValue('1');
  });

  test('a quantity above 99 is capped at 99 with a warning, also in the saved cart', { tag: ['@negative'] }, async ({ checkout, cartItems, apiMock }) => {
    const [{ product }] = cartItems;

    const [saved] = await Promise.all([
      apiMock.waitForResponse('PUT', /^\/carts\/[^/]+\/product\/quantity$/),
      checkout.cart.table.setQuantity(product.name, 150),
    ]);

    expect(saved.response.status()).toBe(200);
    await expect(checkout.cart.table.row(product.name).quantity).toHaveValue('99');
    await expect(checkout.toast.message(MESSAGES.atMost99).first()).toBeVisible();
    await checkout.page.reload();
    await expect(checkout.cart.table.row(product.name).quantity).toHaveValue('99');
  });

  test('removing the last line empties the cart and the header link', async ({ checkout, cartItems }) => {
    await checkout.cart.table.remove(cartItems[0].product.name);

    await expect(checkout.cart.emptyMessage).toBeVisible();
    await expect(checkout.header.cartLink).toHaveCount(0);
  });

  test('the remove control is a button with an accessible name', { tag: ['@a11y', '@bug'] }, async ({ checkout, cartItems }) => {
    knownBug('A11Y-01', 'the remove-line control is an <a> with an icon, no href and no accessible name.');
    const row = checkout.cart.table.row(cartItems[0].product.name);
    await expect(row.removeButton).toBeVisible();

    await expect(row.root.getByRole('button', { name: /remove|delete/i }), 'A11Y-01: the remove control is a button with an accessible name').toBeVisible({ timeout: 2_000 });
  });

  test('Continue Shopping goes back to the shop', async ({ checkout, page }) => {
    await checkout.cart.continueShopping();

    await expect(page).toHaveURL('/');
  });

  test('Proceed to checkout moves on to the sign-in step', async ({ checkout }) => {
    await checkout.cart.proceed();

    await expect(checkout.signIn.signInTab).toBeVisible();
    await expect(checkout.signIn.guestTab).toBeVisible();
  });

  /**
   * Discounts are checked against a cart with fixed prices, so the expected figures are written
   * out (5% of 80.00 is 4.00, 15% of 80.00 is 12.00) and not computed with the app's own rule.
   * The 15% combination discount is the cart's own `additional_discount_percentage`; the page
   * turns it into an amount, which is what is checked here.
   */
  const cartOf = (items: { name: string; price: number; quantity: number; eco?: boolean; rental?: boolean }[], additionalDiscountPercentage: number | null = null) =>
    mock.respond('GET', /^\/carts\/[^/]+$/, {
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

  test.describe('with only an eco-friendly product', { tag: ['@mocked'] }, () => {
    test.use(withMocks(cartOf([{ name: 'QA Lab Eco Saw', price: 80, quantity: 1, eco: true }])));

    test('a 5% eco-friendly discount comes off the subtotal', async ({ checkout }) => {
      const { table } = checkout.cart;

      await expect(table.subtotal).toShowAmount(80);
      await expect(table.ecoDiscount).toShowAmount(-4);
      await expect(table.total).toShowAmount(76);
    });
  });

  test.describe('with a rental and a product', { tag: ['@mocked'] }, () => {
    test.use(withMocks(cartOf([{ name: 'QA Lab Rental Drill', price: 50, quantity: 1, rental: true }, { name: 'QA Lab Hammer', price: 30, quantity: 1 }], 15)));

    test('a 15% combination discount applies and the rental is priced per hour', async ({ checkout }) => {
      const { table } = checkout.cart;

      await expect(table.row('QA Lab Rental Drill').root).toContainText('Item for rent, price per hour');
      await expect(table.subtotal).toShowAmount(80);
      await expect(table.discount).toShowAmount(-12);
      await expect(table.total).toShowAmount(68);
    });
  });

  test.describe('with no cart at all', () => {
    test.use({ cartItems: [] });

    test('the cart page says the cart is empty', { tag: ['@negative', '@bug'] }, async ({ checkout }) => {
      knownBug('BUG-13', 'a visitor without a cart sees only the step header, not "The cart is empty".');
      await expect(checkout.wizard.indicator.steps).toHaveCount(CHECKOUT_STEPS.length);

      await expect(checkout.cart.emptyMessage, 'BUG-13: a visitor without a cart is told the cart is empty').toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('when the cart comes back without items', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('GET', /^\/carts\/[^/]+$/, { id: 'qa-lab', additional_discount_percentage: null, lat: null, lng: null, cart_items: [] })));

    test('the empty-cart message is shown', async ({ checkout }) => {
      await expect(checkout.cart.emptyMessage).toBeVisible();
      await expect(checkout.cart.proceedButton).toBeHidden();
    });
  });

  test.describe('when the cart fails to load', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', /^\/carts\/[^/]+$/, 500)));

    test('the shopper is told the cart could not be loaded', async ({ checkout }) => {
      knownBug('BUG-32', 'a failed cart request shows only the step header: no lines, no message.');
      await expect(checkout.wizard.indicator.steps).toHaveCount(CHECKOUT_STEPS.length);

      await expect(checkout.shell.errorAlert, 'BUG-32: a failed cart request is reported').toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('when saving a quantity fails', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('PUT', /^\/carts\/[^/]+\/product\/quantity$/, 500)));

    test('the line keeps its old total', async ({ checkout, cartItems }) => {
      knownBug('BUG-14', 'after a failed quantity update the line total shows the new quantity while the cart total keeps the old one.');
      const [{ product }] = cartItems;

      await checkout.cart.table.setQuantity(product.name, 3);

      await expect(checkout.toast.message(MESSAGES.serverError)).toBeVisible();
      await expect(checkout.cart.table.row(product.name).linePrice, 'BUG-14: the line keeps the total of the saved quantity').toShowAmount(product.price, { timeout: 5_000 });
    });
  });

  test.describe('when removing a line fails', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('DELETE', /^\/carts\/[^/]+\/product\/[^/]+$/, 500)));

    test('the shopper is told the line was not removed', async ({ checkout, cartItems, apiMock }) => {
      knownBug('BUG-15', 'a failed remove does nothing visible: no toast, the line just stays.');

      const [{ response }] = await Promise.all([
        apiMock.waitForResponse('DELETE', /^\/carts\/[^/]+\/product\/[^/]+$/),
        checkout.cart.table.remove(cartItems[0].product.name),
      ]);

      expect(response.status()).toBe(500);
      await expect(checkout.cart.table.rows).toHaveCount(1);
      await expect(checkout.shell.errorAlert, 'BUG-15: a failed remove is reported').toBeVisible({ timeout: 5_000 });
    });
  });
});
