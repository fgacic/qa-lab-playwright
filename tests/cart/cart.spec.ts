import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';

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

      await expect(checkout.toast.message('Product quantity updated.')).toBeVisible();
      await expect(checkout.cart.table.row(first.product.name).linePrice).toShowAmount(first.product.price * 4);
      await expect(checkout.cart.table.total).toShowAmount(first.product.price * 4 + second.product.price);
      await expect(checkout.header.cartLink).toHaveText('5');
    });

    test('removing a line drops it from the cart and the total', async ({ checkout, cartItems }) => {
      const [first, second] = cartItems;

      await checkout.cart.table.remove(first.product.name);

      await expect(checkout.toast.message('Product deleted.')).toBeVisible();
      await expect(checkout.cart.table.rows).toHaveCount(1);
      await expect(checkout.cart.table.row(second.product.name).title).toBeVisible();
      await expect(checkout.cart.table.total).toShowAmount(second.product.price);
    });
  });

  test('a quantity of 0 is corrected to 1', { tag: ['@negative'] }, async ({ checkout, cartItems }) => {
    const [{ product }] = cartItems;

    await checkout.cart.table.setQuantity(product.name, 0);

    await expect(checkout.cart.table.row(product.name).quantity).toHaveValue('1');
  });

  test('a quantity above 99 is capped at 99 with a warning', { tag: ['@negative'] }, async ({ checkout, cartItems }) => {
    const [{ product }] = cartItems;

    await checkout.cart.table.setQuantity(product.name, 150);

    await expect(checkout.cart.table.row(product.name).quantity).toHaveValue('99');
    await expect(checkout.toast.message('You can order at most 99 of this product.').first()).toBeVisible();
  });

  test('removing the last line empties the cart and the header link', async ({ checkout, cartItems }) => {
    await checkout.cart.table.remove(cartItems[0].product.name);

    await expect(checkout.cart.emptyMessage).toBeVisible();
    await expect(checkout.header.cartLink).toHaveCount(0);
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

  test.describe('with only an eco-friendly product', () => {
    test.use({ cartItems: async ({ catalog }, use) => use([{ product: await catalog.eco(), quantity: 1 }]) });

    test('a 5% eco-friendly discount comes off the subtotal', async ({ checkout, cartItems }) => {
      const price = cartItems[0].product.price;
      const discount = Math.round(price * 0.05 * 100) / 100;
      const { table } = checkout.cart;

      await expect(table.subtotal).toShowAmount(price);
      await expect(table.ecoDiscount).toShowAmount(-discount);
      await expect(table.total).toShowAmount(price - discount);
    });
  });

  test.describe('with a rental and a product', () => {
    test.use({
      cartItems: async ({ catalog }, use) =>
        use([
          { product: await catalog.rental(), quantity: 1 },
          { product: await catalog.nonEco(), quantity: 1 },
        ]),
    });

    test('a 15% combination discount applies and the rental is priced per hour', async ({ checkout, cartItems }) => {
      const subtotal = cartItems.reduce((sum, i) => sum + i.product.price, 0);
      const discount = Math.round(subtotal * 0.15 * 100) / 100;
      const { table } = checkout.cart;

      await expect(table.row(cartItems[0].product.name).root).toContainText('Item for rent, price per hour');
      await expect(table.subtotal).toShowAmount(subtotal);
      await expect(table.discount).toShowAmount(-discount);
      await expect(table.total).toShowAmount(subtotal - discount);
    });
  });

  test.describe('with no cart at all', () => {
    test.use({ cartItems: [] });

    test('the cart page says the cart is empty', { tag: ['@negative', '@bug'] }, async ({ checkout }) => {
      knownBug('BUG-13', 'a visitor without a cart sees only the step header, not "The cart is empty".');
      await expect(checkout.wizard.indicator.steps).toHaveCount(4);

      await expect(checkout.cart.emptyMessage).toBeVisible({ timeout: 5_000 });
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
      knownBug('BUG-13', 'a failed cart request shows only the step header: no lines, no message.');
      await expect(checkout.wizard.indicator.steps).toHaveCount(4);

      await expect(checkout.shell.errorAlert).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('when saving a quantity fails', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('PUT', /^\/carts\/[^/]+\/product\/quantity$/, 500)));

    test('the line keeps its old total', async ({ checkout, cartItems }) => {
      knownBug('BUG-14', 'after a failed quantity update the line total shows the new quantity while the cart total keeps the old one.');
      const [{ product }] = cartItems;

      await checkout.cart.table.setQuantity(product.name, 3);

      await expect(checkout.toast.message('Server Error')).toBeVisible();
      await expect(checkout.cart.table.row(product.name).linePrice).toShowAmount(product.price, { timeout: 5_000 });
    });
  });

  test.describe('when removing a line fails', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('DELETE', /^\/carts\/[^/]+\/product\/[^/]+$/, 500)));

    test('the shopper is told the line was not removed', async ({ checkout, cartItems }) => {
      knownBug('BUG-15', 'a failed remove does nothing visible: no toast, the line just stays.');

      await checkout.cart.table.remove(cartItems[0].product.name);

      await expect(checkout.cart.table.rows).toHaveCount(1);
      await expect(checkout.shell.errorAlert).toBeVisible({ timeout: 5_000 });
    });
  });
});
