import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { emptyProductPage } from '@support/payloads';

test.describe('Rentals', () => {
  test('lists every rental the shop offers', async ({ api, rentalsPage }) => {
    const rentals = await api.listProducts({ is_rental: 'true' });
    // The page shows one page of rentals and no pager: if the list outgrows a page, fail here rather than compare a partial list.
    expect(rentals.last_page, 'the rentals should fit on one page').toBe(1);

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
    await expect(product.increaseQuantityButton).toBeHidden();
    await expect(product.decreaseQuantityButton).toBeHidden();
  });

  test.describe('when there are no rentals', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.respond('QUERY', '/products', emptyProductPage())));

    test('the page says there is nothing to rent', async ({ rentalsPage }) => {
      knownBug('BUG-07', 'an empty rentals list shows only the heading, no empty-state message.', { absence: true });
      await expect(rentalsPage.title).toBeVisible();

      await expect(rentalsPage.grid.emptyState, 'BUG-07: an empty rentals list shows an empty-state message').toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('when the rentals fail to load', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('QUERY', '/products', 500)));

    test('the page still renders and explains the failure', async ({ rentalsPage }) => {
      knownBug('BUG-08', 'a failed rentals request blanks the whole page, heading included.', { absence: true });

      await expect(rentalsPage.title, 'BUG-08: a failed rentals request keeps the page heading').toBeVisible({ timeout: 5_000 });
      await expect(rentalsPage.shell.errorAlert, 'BUG-08: a failed rentals request is reported').toBeVisible({ timeout: 5_000 });
    });
  });
});
