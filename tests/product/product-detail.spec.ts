import { expect, mock, test, withMocks } from '@fixtures';
import { allowLoggedFailure } from '@pages/admin/alerts';
import { ProductPage } from '@pages/ProductPage';
import { CART } from '@support/cart-routes';
import { UNKNOWN_PRODUCT_ID } from '@support/catalog-terms';
import { failureFeedback } from '@support/feedback';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { FAVORITE_ID } from '@support/payloads';
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
/** The quantity the page starts at and never goes below. */
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 99;
const OVER_MAX_QUANTITY = 150;
/** The badge an eco-friendly product carries. */
const ECO_BADGE = 'ECO';
/** The one defect of a product page that cannot load its product (an unknown id, a 404, a 500), pinned from three triggers. */
const UNAVAILABLE_SUMMARY = 'a missing or failing product renders an empty page with only "Related products".';
const UNAVAILABLE_MESSAGE = 'BUG-11: the page says the product is unavailable';
/** The quantity the add-to-cart test sends. */
const ADDED_QUANTITY = 3;
/** What the shop answers when a product request fails, by status. */
const PRODUCT_FAILURES = {
  404: { message: 'Requested item not found' },
  500: { message: 'Server Error' },
} as const;
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

  test('lists the product specifications the API holds, with their units', async ({ productPage, product, api }) => {
    const { specs } = await api.product(product.id);
    expect(specs, 'the product should have specifications').not.toHaveLength(0);

    await expect(productPage.specifications).toHaveCount(specs.length);
    for (const { spec_name: name, spec_value: value, spec_unit: unit } of specs) {
      await expect(productPage.specification(name).getByRole('cell'), `the specification "${name}"`).toHaveText([name, `${value}${unit ?? ''}`]);
    }
  });

  test('the quantity buttons count up and down but never below 1', async ({ productPage }) => {
    await expect(productPage.quantity).toHaveValue(String(MIN_QUANTITY));

    await productPage.increaseQuantityButton.click();
    await productPage.increaseQuantityButton.click();
    await expect(productPage.quantity).toHaveValue(String(MIN_QUANTITY + 2));

    await productPage.decreaseQuantityButton.click();
    await expect(productPage.quantity).toHaveValue(String(MIN_QUANTITY + 1));
    await productPage.decreaseQuantityButton.click();
    await productPage.decreaseQuantityButton.click();
    await expect(productPage.quantity).toHaveValue(String(MIN_QUANTITY));
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
    const added = apiMock.waitForRequest('POST', CART);

    await productPage.addToCart(ADDED_QUANTITY);

    expect((await added).postDataJSON()).toEqual({ product_id: product.id, quantity: ADDED_QUANTITY });
    await expect(productPage.toast.message(MESSAGES.added)).toBeVisible();
    await expect(productPage.header.cartLink).toHaveText(String(ADDED_QUANTITY));
  });

  // The shop refuses the write itself (401); a mock answers it so the live guard never has to block a real POST.
  test.describe('while signed out', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('POST', '/favorites', 401, { message: 'Unauthorized' })));

    test('a 401 on adding to favourites shows the unauthorized message and keeps the shopper on the product', { tag: ['@negative'] }, async ({ productPage, product, page, apiMock }) => {
      const asked = apiMock.waitForRequest('POST', '/favorites');

      await productPage.addToFavourites();

      expect((await asked).postDataJSON()).toEqual({ product_id: product.id });
      await expect(productPage.toast.message(MESSAGES.favouriteSignedOut)).toBeVisible();
      // No redirect to the login page: the shopper stays on the product.
      await expect(page).toHaveURL(`/product/${product.id}`);
    });
  });

  test('a related product opens its own page', async ({ productPage, product, page, api }) => {
    await expect(productPage.relatedHeading).toBeVisible();
    const related = await api.related(product.id);
    await expect.poll(() => productPage.relatedIds(), 'the page shows the related products the API names').toEqual(related.map((p) => p.id));
    const [first] = related;
    await expect(productPage.relatedName(0)).toHaveText(first.name);

    await productPage.openRelated(0);

    await expect(page).toHaveURL(`/product/${first.id}`);
    await expect(productPage.name).toHaveText(first.name);
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
      await expect(productPage.ecoBadge).toHaveText(ECO_BADGE);
    });
  });

  test.describe('when signed in (mocked session)', { tag: ['@mocked'] }, () => {
    test('adding to favourites confirms it', async ({ signedInProductPage: productPage, product, apiMock }) => {
      await apiMock.use(mock.respond('POST', '/favorites', { id: FAVORITE_ID }, 201));
      const asked = apiMock.waitForRequest('POST', '/favorites');

      await productPage.addToFavourites();

      expect((await asked).postDataJSON()).toEqual({ product_id: product.id });
      await expect(productPage.toast.message(MESSAGES.favouriteAdded)).toBeVisible();
    });

    test('a product the shop already holds as a favourite is reported as one', { tag: ['@negative'] }, async ({ signedInProductPage: productPage, apiMock }) => {
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
      // The header has rendered, so the cart link's absence is a fact and not a page still loading.
      await expect(productPage.header.brandLink).toBeVisible();
      await expect(productPage.header.cartLink).toHaveCount(0);
    });
  });

  test.describe('when the cart API cannot be reached', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.abort('POST', /^\/carts(\/[^/]+)?$/)));

    test('the shopper is told the product was not added', async ({ productPage }) => {
      knownBug('BUG-10', 'when the cart request fails at network level, Add to cart does nothing at all: no toast, no error.', { absence: true });
      await productPage.addToCart();

      await expect(failureFeedback(productPage.page).first(), 'BUG-10: a failed add to cart is reported').toBeVisible({ timeout: BUG_TIMEOUT });
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
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the shopper is told, and the product itself is unaffected', async ({ productPage, product, apiMock }) => {
      knownBug('BUG-43', 'a failed related-products request leaves the "Related products" heading over nothing, with no message.', { absence: true });
      await expect(productPage.name).toHaveText(product.name);
      await expect(productPage.addToCartButton).toBeEnabled();
      await expect.poll(() => apiMock.requestsTo('GET', RELATED), 'the related products were asked for').toBeGreaterThan(0);

      await expect(failureFeedback(productPage.page).first(), 'BUG-43: a failed related-products request is reported').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('an id no product has', { tag: ['@negative', '@bug'] }, () => {
    // The page opens on the id, not on a product of the catalogue: the page fixture is replaced by one that opens the unknown id.
    test.use({
      productPage: async ({ page }, use) => {
        const productPage = new ProductPage(page);
        await productPage.open(UNKNOWN_PRODUCT_ID);
        await use(productPage);
      },
    });

    test('the page says the product is unavailable', async ({ productPage, consoleGuard }) => {
      consoleGuard.allowStatus(404, /^\/products\/[^/]+$/, 'the page opens an id the shop does not know, and the browser logs the 404 it is answered with');
      knownBug('BUG-11', UNAVAILABLE_SUMMARY, { absence: true });
      // Holds whether or not the page explains itself: nothing can be bought on it.
      await expect(productPage.addToCartButton).toBeHidden();

      await expect(failureFeedback(productPage.page).or(productPage.unavailableMessage).first(), UNAVAILABLE_MESSAGE).toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  for (const status of [404, 500] as const) {
    test.describe(`when the product request answers ${status}`, { tag: ['@mocked', '@bug'] }, () => {
      test.use(withMocks(mock.fail('GET', /^\/products\/[^/]+$/, status, PRODUCT_FAILURES[status])));
      test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

      test('the page says the product is unavailable', async ({ productPage }) => {
        knownBug('BUG-11', UNAVAILABLE_SUMMARY, { absence: true });

        await expect(failureFeedback(productPage.page).or(productPage.unavailableMessage).first(), UNAVAILABLE_MESSAGE).toBeVisible({ timeout: BUG_TIMEOUT });
      });
    });
  }
});
