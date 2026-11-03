import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';

test.describe('Product detail', () => {
  test('shows the product as the API describes it', { tag: ['@smoke'] }, async ({ productPage, product }) => {
    await expect(productPage.name).toHaveText(product.name);
    await expect(productPage.price).toHaveText(product.price.toFixed(2));
    await expect(productPage.description).toHaveText(product.description);
    await expect(productPage.addToCartButton).toBeEnabled();
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

  for (const { typed, clampedTo } of [
    { typed: '0', clampedTo: '1' },
    { typed: '', clampedTo: '1' },
    { typed: '2.5', clampedTo: '2' },
  ]) {
    test(`a typed quantity of "${typed}" is corrected to ${clampedTo}`, { tag: ['@negative'] }, async ({ productPage }) => {
      await productPage.typeQuantity(typed);

      await expect(productPage.quantity).toHaveValue(clampedTo);
    });
  }

  test('a quantity above 99 is capped at 99 with a warning', { tag: ['@negative'] }, async ({ productPage }) => {
    await productPage.typeQuantity(150);

    await expect(productPage.quantity).toHaveValue('99');
    await expect(productPage.toast.message('You can order at most 99 of this product.').first()).toBeVisible();
  });

  test('Add to cart puts the chosen quantity in the cart', { tag: ['@smoke'] }, async ({ productPage, product, apiMock }) => {
    const added = apiMock.waitForRequest('POST', /^\/carts\/[^/]+$/);

    await productPage.addToCart(3);

    expect((await added).postDataJSON()).toEqual({ product_id: product.id, quantity: 3 });
    await expect(productPage.toast.message('Product added to shopping cart.')).toBeVisible();
    await expect(productPage.header.cartLink).toHaveText('3');
  });

  test('adding to favourites while signed out is refused', { tag: ['@negative'] }, async ({ productPage, page }) => {
    await productPage.addToFavourites();

    await expect(productPage.toast.message('Unauthorized, can not add product to your favorite list.')).toBeVisible();
    await expect(page).toHaveURL(/\/product\//);
  });

  test('a related product opens its own page', async ({ productPage, product, page }) => {
    await expect(productPage.relatedHeading).toBeVisible();
    const [related] = await productPage.relatedNames();

    await productPage.openRelated(related);

    await expect(productPage.name).toHaveText(related);
    await expect(page).not.toHaveURL(`/product/${product.id}`);
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
    test('adding to favourites confirms it', async ({ signedIn: _, productPage, apiMock }) => {
      await apiMock.use(mock.respond('POST', '/favorites', { id: '01QALABFAKEFAVORITE000000' }, 201));

      await productPage.addToFavourites();

      await expect(productPage.toast.message('Product added to your favorites list.')).toBeVisible();
    });

    test('adding a product twice says it is already a favourite', { tag: ['@negative'] }, async ({ signedIn: _, productPage, apiMock }) => {
      await apiMock.use(mock.fail('POST', '/favorites', 422, { message: 'Duplicate Entry' }));

      await productPage.addToFavourites();

      await expect(productPage.toast.message('Product already in your favorites list.')).toBeVisible();
    });
  });

  test.describe('when adding to the cart fails', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('POST', /^\/carts(\/[^/]+)?$/, 500)));

    test('the shopper is told and the cart stays empty', async ({ productPage }) => {
      await productPage.addToCart();

      await expect(productPage.toast.message('Server Error')).toBeVisible();
      await expect(productPage.header.cartLink).toHaveCount(0);
    });
  });

  test.describe('when the cart API cannot be reached', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.abort('POST', /^\/carts(\/[^/]+)?$/)));

    test('the shopper is told the product was not added', async ({ productPage }) => {
      knownBug('BUG-10', 'when the cart request fails at network level, Add to cart does nothing at all: no toast, no error.');
      await productPage.addToCart();

      await expect(productPage.shell.errorAlert).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('when there are no related products', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('GET', /^\/products\/[^/]+\/related$/, [])));

    test('the related section is empty', async ({ productPage }) => {
      await expect(productPage.name).toBeVisible();
      await expect(productPage.relatedProducts).toHaveCount(0);
    });
  });

  for (const status of [404, 500]) {
    test.describe(`when the product request answers ${status}`, { tag: ['@mocked', '@bug'] }, () => {
      test.use(withMocks(mock.fail('GET', /^\/products\/[^/]+$/, status, { message: status === 404 ? 'Requested item not found' : 'Server Error' })));

      test('the page says the product is unavailable', async ({ productPage }) => {
        knownBug('BUG-11', 'a missing or failing product renders an empty page with only "Related products".');
        await expect(productPage.relatedHeading).toBeVisible();

        await expect(productPage.shell.errorAlert.or(productPage.unavailableMessage)).toBeVisible({ timeout: 5_000 });
      });
    });
  }
});
