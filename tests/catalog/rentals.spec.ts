import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { emptyProductPage } from '@support/payloads';

test.describe('Rentals', () => {
  test('lists every rental the shop offers', async ({ api, rentalsPage }) => {
    const rentals = await api.listProducts({ is_rental: 'true' });

    await expect(rentalsPage.title).toBeVisible();
    await expect(rentalsPage.grid.names).toHaveText(rentals.data.map((p) => p.name));
  });

  test('a rental opens on its own page, without a quantity picker', async ({ catalog, rentalsPage, page }) => {
    const rental = await catalog.rental();

    const product = await rentalsPage.openRental(rental.name);

    await expect(page).toHaveURL(`/product/${rental.id}`);
    await expect(product.name).toHaveText(rental.name);
    await expect(product.addToCartButton).toBeEnabled();
    await expect(product.quantity).toBeHidden();
  });

  test.describe('when there are no rentals', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.respond('QUERY', '/products', emptyProductPage())));

    test('the page says there is nothing to rent', async ({ rentalsPage }) => {
      knownBug('BUG-07', 'an empty rentals list shows only the heading, no empty-state message.');
      await expect(rentalsPage.title).toBeVisible();

      await expect(rentalsPage.grid.emptyState).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('when the rentals fail to load', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('QUERY', '/products', 500)));

    test('the page still renders and explains the failure', async ({ rentalsPage }) => {
      knownBug('BUG-08', 'a failed rentals request blanks the whole page, heading included.');

      await expect(rentalsPage.title).toBeVisible({ timeout: 5_000 });
      await expect(rentalsPage.shell.errorAlert).toBeVisible({ timeout: 5_000 });
    });
  });
});
