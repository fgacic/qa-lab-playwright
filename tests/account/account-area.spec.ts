import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { fakeFavorite, fakeInvoice, fakeMessage, fakeUser, page as paged } from '@support/payloads';

/**
 * The signed-in area with a mocked session: a fake token and mocked account endpoints, so it
 * runs anywhere without an account. The real thing is covered in real-account.spec.ts.
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

    test('lists the contact messages, opens one and replies to it', async ({ messagesPage, apiMock }) => {
      await apiMock.use(mock.respond('POST', `/messages/${fakeMessage.id}/reply`, { id: '01QALABFAKEREPLY', message: 'ok' }, 201));
      await expect(messagesPage.messageRows).toHaveCount(1);

      const details = await messagesPage.openDetails('webmaster');
      await expect(details.text(fakeMessage.message)).toBeVisible();
      await expect(details.repliesHeading).toBeVisible();

      const reply = apiMock.waitForRequest('POST', `/messages/${fakeMessage.id}/reply`);
      await details.sendReply('A mocked reply from the qa-lab suite.');
      expect((await reply).postDataJSON()).toEqual({ message: 'A mocked reply from the qa-lab suite.' });
    });
  });

  test.describe('with no messages', () => {
    test.use(withMocks(mock.respond('GET', '/messages', paged([]))));

    test('the empty state points to the contact form', async ({ messagesPage }) => {
      await expect(messagesPage.emptyState).toContainText('Navigate to the contact form');
    });
  });

  test.describe('profile', () => {
    test.use(withMocks(
      mock.respond('POST', '/totp/setup', {}),
      mock.respond('PUT', /^\/users\/[^/]+$/, { success: true }),
      mock.respond('POST', '/users/change-password', { success: true }),
    ));

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

    test('changing the password sends the current and the new one', async ({ profilePage, apiMock }) => {
      const sent = apiMock.waitForRequest('POST', '/users/change-password');

      await profilePage.changePassword('Qa-lab-old-pass-1!', 'Qa-lab-new-pass-2!');

      expect((await sent).postDataJSON()).toEqual({
        current_password: 'Qa-lab-old-pass-1!',
        new_password: 'Qa-lab-new-pass-2!',
        new_password_confirmation: 'Qa-lab-new-pass-2!',
      });
    });

    test('an empty password change is stopped by the form', { tag: ['@negative', '@bug'] }, async ({ profilePage, apiMock }) => {
      knownBug('BUG-26', 'Change Password with every field empty is sent to the API instead of being validated in the form.');
      const sent = apiMock.waitForRequest('POST', '/users/change-password');

      await profilePage.changePasswordButton.click();

      // It is sent (the defect), where the form should have said what is missing.
      await sent;
      await expect(profilePage.alerts.filter({ hasText: /required/i }).first()).toBeVisible({ timeout: 2_000 });
    });
  });

  test('"Sign out" is a real link or button', { tag: ['@a11y', '@bug'] }, async ({ accountPage }) => {
    knownBug('A11Y-04', '"Sign out" is an <a> without href: no link role, not reachable with Tab.');
    await accountPage.header.userMenu.click();
    await expect(accountPage.header.userMenuItem('Sign out')).toBeVisible();

    await expect(accountPage.header.signOutControl).toBeVisible({ timeout: 2_000 });
  });
});
