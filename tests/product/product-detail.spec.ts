import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { escapeRegExp } from '@support/regexp';

/** What the shop tells the shopper, word for word. */
const MESSAGES = {
  added: 'Product added to shopping cart.',
  atMost99: 'You can order at most 99 of this product.',
  favouriteAdded: 'Product added to your favorites list.',
  favouriteDuplicate: 'Product already in your favorites list.',
  favouriteSignedOut: 'Unauthorized, can not add product to your favorite list.',
} as const;
/** What the page does with quantities that are not a number from 1 to 99. */
const QUANTITY_CASES = [
  { typed: '0', clampedTo: '1' },
  { typed: '', clampedTo: '1' },
  { typed: '2.5', clampedTo: '2' },
  { typed: '-1', clampedTo: '1' },
] as const;
const MAX_QUANTITY = 99;
const OVER_MAX_QUANTITY = 150;
/** The quantity the add-to-cart test sends. */
const ADDED_QUANTITY = 3;
/** The related-products endpoint of any product. */
const RELATED = /^\/products\/[^/]+\/related$/;
/** A server message nobody would write by accident: seeing it in the toast proves the app shows what the server said. */
const SERVER_MESSAGE = 'qa-lab: the cart service is down for maintenance';

test.describe('Product detail', () => {
  test('shows the product as the API describes it', { tag: ['@smoke'] }, async ({ productPage, product }) => {
    await expect(productPage.name).toHaveText(product.name);
    await expect(productPage.price).toHaveText(product.price.toFixed(2));
    await expect(productPage.description).toHaveText(product.description);
    await expect(productPage.addToCartButton).toBeEnabled();
  });

  test('the picture is the one of the catalogue and has the product name as alt text', async ({ productPage, product }) => {
    const image = productPage.image(product.name);

    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src', new RegExp(`/${escapeRegExp(product.product_image.file_name)}$`));
  });

  test('lists the product specifications', async ({ productPage }) => {
    await expect(productPage.specifications.first()).toBeVisible();
    await expect(productPage.specification('Warranty')).toBeVisible();
  });

  test('the quantity buttons count up and down but never below 1', async ({ productPage }) => {
    await expect(productPage.quantity).toHaveValue('1');

    await productPage.increaseQuantityButton.click();
    await productPage.increaseQuantityButton.click();
    await expect(productPage.quantity).toHaveValue('3');

    await productPage.decreaseQuantityButton.click();
    await expect(productPage.quantity).toHaveValue('2');
    await productPage.decreaseQuantityButton.click();
    await productPage.decreaseQuantityButton.click();
    await expect(productPage.quantity).toHaveValue('1');
  });

  for (const { typed, clampedTo } of QUANTITY_CASES) {
    test(`a typed quantity of "${typed}" is corrected to ${clampedTo}`, { tag: ['@negative'] }, async ({ productPage }) => {
      await productPage.typeQuantity(typed);

      await expect(productPage.quantity).toHaveValue(clampedTo);
    });
  }

  test('a quantity above 99 is capped at 99 with a warning', { tag: ['@negative'] }, async ({ productPage }) => {
    await productPage.typeQuantity(OVER_MAX_QUANTITY);

    await expect(productPage.quantity).toHaveValue(String(MAX_QUANTITY));
    await expect(productPage.toast.message(MESSAGES.atMost99).first()).toBeVisible();
  });

  test('the + button stops at 99 with the same warning', { tag: ['@negative'] }, async ({ productPage }) => {
    await productPage.typeQuantity(MAX_QUANTITY);

    await productPage.increaseQuantityButton.click();

    await expect(productPage.quantity).toHaveValue(String(MAX_QUANTITY));
    await expect(productPage.toast.message(MESSAGES.atMost99).first()).toBeVisible();
  });

  // Adding to the cart is a write on the live site too: an anonymous cart, the same one `seedCart`
  // creates to arrange other specs. It holds no account, no order and no personal data, so the
  // smoke test runs there for real instead of behind a mock that would prove nothing.
  test('Add to cart puts the chosen quantity in the cart', { tag: ['@smoke'] }, async ({ productPage, product, apiMock }) => {
    const added = apiMock.waitForRequest('POST', /^\/carts\/[^/]+$/);

    await productPage.addToCart(ADDED_QUANTITY);

    expect((await added).postDataJSON()).toEqual({ product_id: product.id, quantity: ADDED_QUANTITY });
    await expect(productPage.toast.message(MESSAGES.added)).toBeVisible();
    await expect(productPage.header.cartLink).toHaveText(String(ADDED_QUANTITY));
  });

  test('adding to favourites while signed out is refused', { tag: ['@negative'] }, async ({ productPage, product, page }) => {
    await productPage.addToFavourites();

    await expect(productPage.toast.message(MESSAGES.favouriteSignedOut)).toBeVisible();
    // No redirect to the login page: the shopper stays on the product.
    await expect(page).toHaveURL(`/product/${product.id}`);
  });

  test('a related product opens its own page', async ({ productPage, product, page, api }) => {
    await expect(productPage.relatedHeading).toBeVisible();
    const [relatedName] = await productPage.relatedNames();
    const related = (await api.related(product.id)).find((p) => p.name === relatedName);
    expect(related, `"${relatedName}" should be one of the product's related products`).toBeDefined();

    await productPage.openRelated(relatedName);

    await expect(page).toHaveURL(`/product/${related!.id}`);
    await expect(productPage.name).toHaveText(relatedName);
  });

  test.describe('an out-of-stock product', () => {
    test.use({ productKind: 'out-of-stock' });

    test('says so and cannot be added to the cart', { tag: ['@negative'] }, async ({ productPage }) => {
      await expect(productPage.outOfStock).toBeVisible();
      await expect(productPage.addToCartButton).toBeDisabled();
      await expect(productPage.quantity).toBeDisabled();
      await expect(productPage.increaseQuantityButton).toBeDisabled();
      await expect(productPage.decreaseQuantityButton).toBeDisabled();
      // Wanting it later is still possible.
      await expect(productPage.addToFavouritesButton).toBeEnabled();
    });
  });

  test.describe('an eco-friendly product', () => {
    test.use({ productKind: 'eco' });

    test('carries the ECO badge', async ({ productPage }) => {
      await expect(productPage.ecoBadge).toHaveText('ECO');
    });
  });

  test.describe('when signed in (mocked session)', { tag: ['@mocked'] }, () => {
    test('adding to favourites confirms it', async ({ signedInProductPage: productPage, apiMock }) => {
      await apiMock.use(mock.respond('POST', '/favorites', { id: '01QALABFAKEFAVORITE000000' }, 201));

      await productPage.addToFavourites();

      await expect(productPage.toast.message(MESSAGES.favouriteAdded)).toBeVisible();
    });

    test('adding a product twice says it is already a favourite', { tag: ['@negative'] }, async ({ signedInProductPage: productPage, apiMock }) => {
      await apiMock.use(mock.fail('POST', '/favorites', 422, { message: 'Duplicate Entry' }));

      await productPage.addToFavourites();

      await expect(productPage.toast.message(MESSAGES.favouriteDuplicate)).toBeVisible();
    });
  });

  test.describe('when adding to the cart fails', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('POST', /^\/carts(\/[^/]+)?$/, 500, { message: SERVER_MESSAGE })));

    test('the shopper is told and the cart stays empty', async ({ productPage }) => {
      await productPage.addToCart();

      await expect(productPage.toast.message(SERVER_MESSAGE)).toBeVisible();
      await expect(productPage.header.cartLink).toHaveCount(0);
    });
  });

  test.describe('when the cart API cannot be reached', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.abort('POST', /^\/carts(\/[^/]+)?$/)));

    test('the shopper is told the product was not added', async ({ productPage }) => {
      knownBug('BUG-10', 'when the cart request fails at network level, Add to cart does nothing at all: no toast, no error.');
      await productPage.addToCart();

      await expect(productPage.shell.errorAlert, 'BUG-10: a failed add to cart is reported').toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('when there are no related products', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('GET', RELATED, [])));

    test('the related section is empty', async ({ productPage, apiMock }) => {
      // Reload with the answer awaited: an empty section only means something once the data has arrived.
      await Promise.all([
        apiMock.waitForResponse('GET', RELATED),
        productPage.page.reload({ waitUntil: 'domcontentloaded' }),
      ]);
      await expect(productPage.name).toBeVisible();
      await expect(productPage.relatedProducts).toHaveCount(0);
    });
  });

  test.describe('when the related products fail to load', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', RELATED, 500)));

    test('the shopper is told, and the product itself is unaffected', async ({ productPage, product, apiMock }) => {
      knownBug('BUG-43', 'a failed related-products request leaves the "Related products" heading over nothing, with no message.');
      await expect(productPage.name).toHaveText(product.name);
      await expect(productPage.addToCartButton).toBeEnabled();
      await expect.poll(() => apiMock.requestsTo('GET', RELATED), 'the related products were asked for').toBeGreaterThan(0);

      await expect(productPage.shell.errorAlert, 'BUG-43: a failed related-products request is reported').toBeVisible({ timeout: 5_000 });
    });
  });

  for (const status of [404, 500]) {
    test.describe(`when the product request answers ${status}`, { tag: ['@mocked', '@bug'] }, () => {
      test.use(withMocks(mock.fail('GET', /^\/products\/[^/]+$/, status, { message: status === 404 ? 'Requested item not found' : 'Server Error' })));

      test('the page says the product is unavailable', async ({ productPage }) => {
        knownBug('BUG-11', 'a missing or failing product renders an empty page with only "Related products".');

        await expect(productPage.shell.errorAlert.or(productPage.unavailableMessage), 'BUG-11: the page says the product is unavailable').toBeVisible({ timeout: 5_000 });
      });
    });
  }
});
