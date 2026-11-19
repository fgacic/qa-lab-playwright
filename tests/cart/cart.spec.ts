import { CART_MESSAGES as MESSAGES } from '@components/CartTable';
import { CHECKOUT_STEPS } from '@components/checkout/StepIndicator';
import { expect, mock, test, withMocks } from '@fixtures';
import { emptyCartMock } from '@fixtures/mocks';
import { twoProductCart } from '@fixtures/pages';
import { allowLoggedFailure } from '@pages/admin/alerts';
import { CART, REMOVE_LINE, SAVE_QUANTITY } from '@support/cart-routes';
import { failureFeedback } from '@support/feedback';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

/** The units a cart holds in all: what the header link counts. */
const unitsIn = (items: { quantity: number }[]) => items.reduce((sum, { quantity }) => sum + quantity, 0);

/** The quantities the specs type, and the figures that follow from them (the cart's own limit is 99). */
const NEW_QUANTITY = 4;
const FAILED_QUANTITY = 3;
const FRACTIONAL_QUANTITY = '2.5';
const CORRECTED_FRACTION = 2;
const ABOVE_LIMIT = 150;
const QUANTITY_LIMIT = 99;
const CORRECTED_MINIMUM = 1;

/** The mocked products of the discount specs, named once: the cart is built from them and its rows are found by them. */
const ECO_SAW = 'QA Lab Eco Saw';
const RENTAL_DRILL = 'QA Lab Rental Drill';
const HAMMER = 'QA Lab Hammer';

/** The two adds of the same product: the first from the page's default quantity, the second typed. */
const FIRST_ADD_QUANTITY = 1;
const SECOND_ADD_QUANTITY = 2;

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

/** Every cart here is created through the API, so each test starts from a known cart. */
test.describe('Cart', () => {
  test.describe('with two different products', () => {
    test.use({ cartItems: twoProductCart });

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
      await expect(checkout.header.cartLink).toHaveText(String(unitsIn(cartItems)));
    });

    test('changing a quantity updates the line, the total and the header count, and the cart keeps it', async ({ checkout, cartItems, apiMock }) => {
      const [first, second] = cartItems;
      const { table } = checkout.cart;
      const total = first.product.price * NEW_QUANTITY + second.product.price;
      const units = NEW_QUANTITY + second.quantity;

      const [saved] = await Promise.all([apiMock.waitForResponse('PUT', SAVE_QUANTITY), table.setQuantity(first.product.name, NEW_QUANTITY)]);

      expect(saved.response.status(), 'the shop saves the new quantity').toBe(200);
      await expect(checkout.toast.message(MESSAGES.quantityUpdated)).toBeVisible();
      await expect(table.row(first.product.name).linePrice).toShowAmount(first.product.price * NEW_QUANTITY);
      await expect(table.total).toShowAmount(total);
      await expect(checkout.header.cartLink).toHaveText(String(units));
      // What the cart saved, not what the page remembers.
      await checkout.page.reload();
      await expect(table.row(first.product.name).quantity).toHaveValue(String(NEW_QUANTITY));
      await expect(table.row(first.product.name).linePrice).toShowAmount(first.product.price * NEW_QUANTITY);
      await expect(table.total).toShowAmount(total);
      await expect(checkout.header.cartLink).toHaveText(String(units));
    });

    test('removing a line drops it from the cart and the total, and the cart keeps it', async ({ checkout, cartItems, apiMock }) => {
      const [first, second] = cartItems;
      const { table } = checkout.cart;

      const [removed] = await Promise.all([apiMock.waitForResponse('DELETE', REMOVE_LINE), table.remove(first.product.name)]);

      expect(removed.response.status(), 'the shop deletes the line').toBe(204);
      await expect(checkout.toast.message(MESSAGES.lineDeleted)).toBeVisible();
      await expect(table.rows).toHaveCount(1);
      await expect(table.row(second.product.name).title).toBeVisible();
      await expect(table.total).toShowAmount(second.product.price);
      await checkout.page.reload();
      await expect(table.rows).toHaveCount(1);
      await expect(table.row(second.product.name).title).toBeVisible();
      await expect(table.row(first.product.name).title).toHaveCount(0);
      await expect(table.total).toShowAmount(second.product.price);
      await expect(checkout.header.cartLink).toHaveText(String(second.quantity));
    });
  });

  // A quantity the shop corrects to 1 (the product page does the same): shown corrected and saved corrected.
  for (const typed of [0, -1, '']) {
    const label = typed === '' ? 'nothing' : String(typed);
    test(`a quantity of ${label} is corrected to ${CORRECTED_MINIMUM}, also in the saved cart`, { tag: ['@negative'] }, async ({ checkout, cartItems, apiMock }) => {
      const [{ product }] = cartItems;

      // The page reads the cart again after a save; a reload before that read ends would cancel it, and WebKit logs the cancelled request as an error.
      const [saved] = await Promise.all([
        apiMock.waitForResponse('PUT', SAVE_QUANTITY),
        apiMock.waitForResponse('GET', CART),
        checkout.cart.table.setQuantity(product.name, typed),
      ]);

      expect(saved.response.status(), 'the shop saves the corrected quantity').toBe(200);
      await expect(checkout.cart.table.row(product.name).quantity).toHaveValue(String(CORRECTED_MINIMUM));
      await checkout.page.reload();
      await expect(checkout.cart.table.row(product.name).quantity).toHaveValue(String(CORRECTED_MINIMUM));
    });
  }

  test('a fractional quantity is corrected to a whole number, also in the saved cart', { tag: ['@negative', '@bug'] }, async ({ checkout, cartItems, consoleGuard }) => {
    consoleGuard.allowStatus(422, /^\/carts\/[^/]+\/product\/quantity$/, 'the test types a fractional quantity, which the shop refuses with a 422 the browser logs');
    knownBug('BUG-42', 'a quantity of 2.5 in the cart is refused by the shop (422, "must be an integer"), yet the line keeps showing 2.5 and a total for 2.5 items; the product page corrects it to 2.');
    const [{ product }] = cartItems;
    const row = checkout.cart.table.row(product.name);

    await checkout.cart.table.setQuantity(product.name, FRACTIONAL_QUANTITY);

    await expect(row.quantity, 'BUG-42: the quantity is corrected to a whole number').toHaveValue(String(CORRECTED_FRACTION), { timeout: BUG_TIMEOUT });
    await expect(row.linePrice, 'BUG-42: the line is priced for the corrected quantity').toShowAmount(product.price * CORRECTED_FRACTION, { timeout: BUG_TIMEOUT });
    await checkout.page.reload();
    await expect(row.quantity, 'BUG-42: the saved quantity is the corrected one').toHaveValue(String(CORRECTED_FRACTION));
  });

  test(`a quantity of ${QUANTITY_LIMIT} is kept, with no warning`, { tag: ['@negative'] }, async ({ checkout, cartItems, apiMock }) => {
    const [{ product }] = cartItems;

    const [saved] = await Promise.all([apiMock.waitForResponse('PUT', SAVE_QUANTITY), checkout.cart.table.setQuantity(product.name, QUANTITY_LIMIT)]);

    expect(saved.response.status(), 'the shop saves the quantity at the limit').toBe(200);
    await expect(checkout.toast.message(MESSAGES.quantityUpdated)).toBeVisible();
    // Not an instant check: the warning is raised when the number is typed, before the save is sent, and toasts last about five seconds.
    // With the save's toast on screen the warning, had the page raised one, would be on screen beside it.
    await expect(checkout.toast.message(MESSAGES.atMost99)).toHaveCount(0);
    await checkout.page.reload();
    await expect(checkout.cart.table.row(product.name).quantity).toHaveValue(String(QUANTITY_LIMIT));
  });

  // One above the limit, and far above it.
  for (const typed of [QUANTITY_LIMIT + 1, ABOVE_LIMIT]) {
    test(`a quantity of ${typed} is capped at ${QUANTITY_LIMIT} with a warning, also in the saved cart`, { tag: ['@negative'] }, async ({ checkout, cartItems, apiMock }) => {
      const [{ product }] = cartItems;

      const [saved] = await Promise.all([apiMock.waitForResponse('PUT', SAVE_QUANTITY), checkout.cart.table.setQuantity(product.name, typed)]);

      expect(saved.response.status(), 'the shop saves the capped quantity').toBe(200);
      await expect(checkout.cart.table.row(product.name).quantity).toHaveValue(String(QUANTITY_LIMIT));
      await expect(checkout.toast.message(MESSAGES.atMost99).first()).toBeVisible();
      await checkout.page.reload();
      await expect(checkout.cart.table.row(product.name).quantity).toHaveValue(String(QUANTITY_LIMIT));
    });
  }

  test('removing the last line empties the cart and the header link', async ({ checkout, cartItems }) => {
    await checkout.cart.table.remove(cartItems[0].product.name);

    await expect(checkout.cart.emptyMessage).toBeVisible();
    await expect(checkout.header.cartLink).toHaveCount(0);
    // The cart itself is empty, not only the page: a reload still finds it so.
    await checkout.page.reload();
    await expect(checkout.cart.emptyMessage).toBeVisible();
    await expect(checkout.header.cartLink).toHaveCount(0);
  });

  test('the remove control is a button with an accessible name', { tag: ['@a11y', '@bug'] }, async ({ checkout, cartItems }) => {
    knownBug('A11Y-01', 'the remove-line control is an <a> with an icon, no href and no accessible name.');
    const row = checkout.cart.table.row(cartItems[0].product.name);
    // The control exists whatever its role: what is asserted below is its role and name, not its presence.
    await expect(row.removeButton).toBeVisible();

    await expect(row.removeButton, 'A11Y-01: the remove control is a button').toHaveRole('button', { timeout: BUG_TIMEOUT });
    await expect(row.removeButton, 'A11Y-01: the remove control has an accessible name').toHaveAccessibleName(/remove|delete/i, { timeout: BUG_TIMEOUT });
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

  test.describe('with only an eco-friendly product', { tag: ['@mocked'] }, () => {
    test.use(withMocks(cartOf([{ name: ECO_SAW, price: 80, quantity: 1, eco: true }])));

    test('a 5% eco-friendly discount comes off the subtotal', async ({ checkout }) => {
      const { table } = checkout.cart;

      await expect(table.subtotal).toShowAmount(80);
      await expect(table.ecoDiscount).toShowAmount(-4);
      await expect(table.total).toShowAmount(76);
    });
  });

  test('adding the same product twice merges into one line with both quantities, also in the saved cart', async ({ productPage, product, apiMock }) => {
    await productPage.addToCart();
    await expect(productPage.toast.message(MESSAGES.added)).toBeVisible();
    const [saved] = await Promise.all([apiMock.waitForResponse('POST', CART), productPage.addToCart(SECOND_ADD_QUANTITY)]);
    expect(saved.response.status(), 'the shop accepts the second add').toBeLessThan(300);

    const checkout = await productPage.openCart();
    const row = checkout.cart.table.row(product.name);
    const units = FIRST_ADD_QUANTITY + SECOND_ADD_QUANTITY;
    await expect(checkout.cart.table.rows).toHaveCount(1);
    await expect(row.quantity).toHaveValue(String(units));
    await checkout.page.reload();
    await expect(checkout.cart.table.rows).toHaveCount(1);
    await expect(row.quantity).toHaveValue(String(units));
    await expect(checkout.header.cartLink).toHaveText(String(units));
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

  test.describe('with a product that is out of stock', { tag: ['@bug'] }, () => {
    test.use({ cartItems: async ({ catalog }, use) => use([{ product: await catalog.outOfStock(), quantity: 1 }]) });

    test('the cart tells the shopper the line cannot be bought', { tag: ['@negative'] }, async ({ checkout, cartItems }) => {
      knownBug('BUG-44', 'a product that is out of stock can sit in the cart: the line is priced like any other, with no notice, and Proceed to checkout stays enabled.', { absence: true });
      const [{ product }] = cartItems;
      const row = checkout.cart.table.row(product.name);
      await expect(row.title).toBeVisible();
      await expect(row.linePrice).toShowAmount(product.price);

      // Either way of refusing the line is a fix: a notice on it (or an alert), or a Proceed that cannot be pressed (disabled, or gone:
      // the count is read first, as isDisabled() would wait for a button that is gone and overrun the window).
      const { proceedButton } = checkout.cart;
      await expect
        .poll(async () => (await row.outOfStock.or(checkout.shell.errorAlert).first().isVisible()) || (await proceedButton.count()) === 0 || (await proceedButton.isDisabled()), {
          message: 'BUG-44: the cart says the out-of-stock line cannot be bought, or will not go on to checkout',
          timeout: BUG_TIMEOUT,
        })
        .toBe(true);
    });
  });

  test.describe('with no cart at all', () => {
    test.use({ cartItems: [] });

    test('the cart page says the cart is empty', { tag: ['@negative', '@bug'] }, async ({ checkout }) => {
      knownBug('BUG-13', 'a visitor without a cart sees only the step header, not "The cart is empty".', { absence: true });
      await expect(checkout.wizard.indicator.steps).toHaveCount(CHECKOUT_STEPS.length);

      await expect(checkout.cart.emptyMessage, 'BUG-13: a visitor without a cart is told the cart is empty').toBeVisible({ timeout: BUG_TIMEOUT });
    });

    test('the checkout page raises no application error', { tag: ['@negative', '@bug'] }, async ({ checkout, consoleGuard }) => {
      knownBug('BUG-38', 'the checkout reads cart_items of a cart that does not exist (yet) and throws a TypeError, again on every change of the page, though the page still draws.');
      // Precondition, true whether or not the bug is fixed: the page has drawn (the step header is there), so the template has run.
      await expect(checkout.wizard.indicator.steps).toHaveCount(CHECKOUT_STEPS.length);

      await expect(consoleGuard.expectNoneLogged(/\bcart_items\b/), 'BUG-38: the checkout threw while it read a missing cart').resolves.toBeUndefined();
    });
  });

  test.describe('when the cart comes back without items', { tag: ['@mocked'] }, () => {
    test.use(withMocks(emptyCartMock));

    test('the empty-cart message is shown', async ({ checkout }) => {
      await expect(checkout.cart.emptyMessage).toBeVisible();
      await expect(checkout.cart.proceedButton).toBeHidden();
    });
  });

  test.describe('when the cart fails to load', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', CART, 500)));

    test('the shopper is told the cart could not be loaded', async ({ checkout, consoleGuard }) => {
      knownBug('BUG-32', 'a failed cart request shows only the step header: no lines, no message.', { absence: true });
      allowLoggedFailure(consoleGuard);
      await expect(checkout.wizard.indicator.steps).toHaveCount(CHECKOUT_STEPS.length);

      await expect(failureFeedback(checkout.page), 'BUG-32: a failed cart request is reported').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('when saving a quantity fails', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('PUT', SAVE_QUANTITY, 500)));

    test('the line keeps its old total', async ({ checkout, cartItems }) => {
      knownBug('BUG-14', 'after a failed quantity update the line total shows the new quantity while the cart total keeps the old one.');
      const [{ product }] = cartItems;

      await checkout.cart.table.setQuantity(product.name, FAILED_QUANTITY);

      await expect(checkout.toast.message(MESSAGES.serverError)).toBeVisible();
      await expect(checkout.cart.table.row(product.name).linePrice, 'BUG-14: the line keeps the total of the saved quantity').toShowAmount(product.price, { timeout: BUG_TIMEOUT });
    });
  });

  test.describe('when removing a line fails', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('DELETE', REMOVE_LINE, 500)));

    test('the shopper is told the line was not removed', async ({ checkout, cartItems, apiMock, consoleGuard }) => {
      knownBug('BUG-15', 'a failed remove does nothing visible: no toast, the line just stays.', { absence: true });
      allowLoggedFailure(consoleGuard);

      const [{ response }] = await Promise.all([
        apiMock.waitForResponse('DELETE', REMOVE_LINE),
        checkout.cart.table.remove(cartItems[0].product.name),
      ]);

      expect(response.status(), 'the mocked failure reaches the page').toBe(500);
      await expect(checkout.cart.table.rows).toHaveCount(1);
      await expect(failureFeedback(checkout.page), 'BUG-15: a failed remove is reported').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });
});
