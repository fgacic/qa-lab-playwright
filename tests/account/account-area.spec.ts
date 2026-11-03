import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { fakeFavorite, fakeInvoice, fakeMessage, fakeUser, page as paged } from '@support/payloads';

/**
 * The signed-in area with a mocked session: a fake token and mocked account endpoints, so it
 * runs anywhere without an account. The real thing is covered in live-account.spec.ts (gated).
 */
test.describe('Account area (mocked session)', { tag: ['@mocked'] }, () => {
  // An account with nothing in it. Any section the SPA opens needs its endpoint mocked: a real
  // 401 makes the SPA drop the session and redirect to login. Nested blocks replace this set.
  test.use(withMocks(
    mock.respond('GET', '/favorites', []),
    mock.respond('GET', '/invoices', paged([])),
    mock.respond('GET', '/messages', paged([])),
    mock.respond('POST', '/totp/setup', {}),
  ));

  test('the account page links to the four sections', async ({ accountPage, page }) => {
    await expect(accountPage.title).toHaveText('My account');

    for (const [section, path] of [['Favorites', '/account/favorites'], ['Profile', '/account/profile'], ['Invoices', '/account/invoices'], ['Messages', '/account/messages']] as const) {
      await accountPage.openSection(section);
      await expect(page).toHaveURL(path);
      await page.goBack();
    }
  });

  test('the header account menu reaches every section', async ({ accountPage, page }) => {
    await expect(accountPage.header.userMenu).toHaveText(`${fakeUser.first_name} ${fakeUser.last_name}`);

    for (const [item, path] of [['My favorites', '/account/favorites'], ['My profile', '/account/profile'], ['My invoices', '/account/invoices'], ['My messages', '/account/messages'], ['My account', '/account']] as const) {
      await accountPage.header.openUserMenuItem(item);
      await expect(page).toHaveURL(path);
    }
  });

  test('signing out forgets the session and sends the customer to login', async ({ accountPage, page }) => {
    await accountPage.header.openUserMenuItem('Sign out');

    await expect(page).toHaveURL('/auth/login');
    await expect(accountPage.header.userMenu).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('auth-token'))).toBeNull();
  });

  test.describe('favorites', () => {
    test.use({
      apiMocks: async ({ catalog }, use) => {
        const product = await catalog.inStock();
        await use({ routes: [mock.sequence('GET', '/favorites', { status: 200, json: [fakeFavorite(product)] }, { status: 200, json: [] }), mock.respond('DELETE', /^\/favorites\/.+$/, '', 204)] });
      },
    });

    test('lists the favourite products and removes one', async ({ favoritesPage, catalog }) => {
      const product = await catalog.inStock();
      await expect(favoritesPage.favorite(product.name)).toBeVisible();

      await favoritesPage.remove(product.name);

      await expect(favoritesPage.favorites).toHaveCount(0);
      await expect(favoritesPage.emptyState).toBeVisible();
    });
  });

  test.describe('with no favorites', () => {
    test.use(withMocks(mock.respond('GET', '/favorites', [])));

    test('the empty state explains how to add one', async ({ favoritesPage }) => {
      await expect(favoritesPage.emptyState).toContainText('please go to the product listing and mark some products as your favorite');
    });
  });

  test.describe('when favorites fail to load', { tag: ['@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', '/favorites', 500)));

    test('the customer is told they could not be loaded', async ({ favoritesPage }) => {
      knownBug('BUG-23', 'a failed favorites request says "There are no favorites yet", which is not true.');
      await expect(favoritesPage.title).toBeVisible();

      await expect(favoritesPage.shell.errorAlert).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('invoices', () => {
    test.use({
      apiMocks: async ({ catalog }, use) => {
        const invoice = fakeInvoice(await catalog.inStock());
        await use({ routes: [mock.respond('GET', '/invoices', paged([invoice])), mock.respond('GET', `/invoices/${invoice.id}`, invoice)] });
      },
    });

    test('lists the orders and opens one with its lines', async ({ invoicesPage, catalog }) => {
      const product = await catalog.inStock();
      await expect(invoicesPage.invoice('INV-2026999999')).toContainText('$' + (product.price * 2).toFixed(2));

      const details = await invoicesPage.openDetails('INV-2026999999');

      await expect(details.downloadPdfButton).toBeVisible();
      await expect(details.productLines.filter({ hasText: product.name })).toContainText('2');
    });
  });

  test.describe('when invoices fail to load', { tag: ['@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', '/invoices', 500)));

    test('the customer is told they could not be loaded', async ({ invoicesPage }) => {
      knownBug('BUG-24', 'a failed invoices request shows the bare page title, no table and no message.');
      await expect(invoicesPage.title).toBeVisible();

      await expect(invoicesPage.shell.errorAlert).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('messages', () => {
    test.use(withMocks(mock.respond('GET', '/messages', paged([fakeMessage])), mock.respond('GET', `/messages/${fakeMessage.id}`, fakeMessage)));

    test('lists the contact messages and opens one', async ({ messagesPage }) => {
      await expect(messagesPage.messageRows).toHaveCount(1);

      const details = await messagesPage.openDetails('webmaster');

      await expect(details.text(fakeMessage.message)).toBeVisible();
      await expect(details.repliesHeading).toBeVisible();
    });
  });

  test.describe('with no messages', () => {
    test.use(withMocks(mock.respond('GET', '/messages', paged([]))));

    test('the empty state points to the contact form', async ({ messagesPage }) => {
      await expect(messagesPage.emptyState).toContainText('Navigate to the contact form');
    });
  });

  test.describe('profile', () => {
    test.use(withMocks(mock.respond('POST', '/totp/setup', {}), mock.respond('PUT', /^\/users\/[^/]+$/, { success: true })));

    test('is filled in from the account', async ({ profilePage }) => {
      await expect(profilePage.firstName.input).toHaveValue(fakeUser.first_name);
      await expect(profilePage.lastName.input).toHaveValue(fakeUser.last_name);
      await expect(profilePage.email.input).toHaveValue(fakeUser.email);
      await expect(profilePage.city.input).toHaveValue(fakeUser.address.city);
    });

    test('saving sends the edited profile', async ({ profilePage, apiMock }) => {
      const saved = apiMock.waitForRequest('PUT', /^\/users\/[^/]+$/);
      await profilePage.firstName.input.fill('Renamed');

      await profilePage.update();

      expect((await saved).postDataJSON()).toMatchObject({ first_name: 'Renamed', last_name: fakeUser.last_name });
    });
  });
});
