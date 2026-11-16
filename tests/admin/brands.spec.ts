import { expect, mock, test, withMocks } from '@fixtures';
import { ADM_12, ADM_14, ADM_23, ADMIN_MESSAGES, allowLoggedFailure } from '@pages/admin/alerts';
import { REFUSED_STATUSES, SEARCH_HIT, brand } from '@support/admin-payloads';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

const NEW_BRAND = { name: 'Qa Lab New Brand', slug: 'qa-lab-new-brand' };
const BRAND = /^\/brands\/[^/]+$/;

test.describe('Admin brands (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows each brand with its slug', async ({ adminBrands }) => {
    await expect(adminBrands.table.row(brand.name)).toContainText(brand.slug);
  });

  test('searching sends the term and lists the matches', async ({ adminBrands, apiMock }) => {
    const match = { id: '01QALABBRANDHIT0000000000', name: SEARCH_HIT, slug: 'qa-lab-search-hit' };
    await apiMock.use(mock.respond('QUERY', '/brands/search', [match]));
    const sent = apiMock.waitForRequest('QUERY', '/brands/search');

    await adminBrands.search.searchFor('hit');

    expect((await sent).postDataJSON()).toEqual({ q: 'hit' });
    await expect(adminBrands.table.row(match.name)).toContainText(match.slug);
    await expect(adminBrands.table.row(brand.name)).toHaveCount(0);
  });

  test('a new brand is saved', async ({ adminBrands, apiMock }) => {
    const form = await adminBrands.add();
    const created = apiMock.waitForRequest('POST', '/brands');

    await form.fillIn(NEW_BRAND);
    await form.chrome.save();

    expect((await created).postDataJSON()).toMatchObject(NEW_BRAND);
    await expect(form.chrome.alert(ADMIN_MESSAGES.brandSaved)).toBeVisible();
  });

  test('name and slug are required', { tag: ['@negative'] }, async ({ adminBrands }) => {
    const form = await adminBrands.add();

    await form.chrome.save();

    await expect(form.name.error).toHaveText('Name is required');
    await expect(form.slug.error).toHaveText('Slug is required');
  });

  test('editing loads the brand and saves the change', async ({ adminBrands, apiMock }) => {
    const form = await adminBrands.edit(brand.name);
    await expect(form.name.input).toHaveValue(brand.name);
    const saved = apiMock.waitForRequest('PUT', `/brands/${brand.id}`);

    await form.name.input.fill('Qa Lab Renamed');
    await form.chrome.save();

    expect((await saved).postDataJSON()).toMatchObject({ id: brand.id, name: 'Qa Lab Renamed', slug: brand.slug });
    await expect(form.chrome.alert(ADMIN_MESSAGES.brandSaved)).toBeVisible();
  });

  test.describe('when the brand cannot be loaded', { tag: ['@negative', '@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', BRAND, 500)));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the admin is told the brand could not be loaded', async ({ adminBrands, apiMock }) => {
      knownBug('ADM-14', ADM_14, { absence: true });
      const failed = apiMock.waitForResponse('GET', BRAND);

      const form = await adminBrands.edit(brand.name);
      await failed;
      await expect(form.chrome.heading).toBeVisible();

      // Any alert, or plain error text, will do: the pin does not prescribe the form or the wording.
      await expect(form.chrome.failure, 'ADM-14: a failed brand load tells the admin').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('when saving a brand is refused', { tag: ['@negative', '@bug'] }, () => {
    // The real API answers a taken slug with 409 and the reason keyed by field (POST /brands, probed on the self-hosted shop;
    // back-office.e2e.spec.ts asks the real backend the same).
    test.use(withMocks(mock.fail('POST', '/brands', 409, { slug: ['A brand already exists with this slug.'] })));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the reason is shown', async ({ adminBrands, apiMock }) => {
      knownBug('ADM-12', ADM_12, { absence: true });
      const form = await adminBrands.add();
      const sent = apiMock.waitForRequest('POST', '/brands');

      await form.fillIn({ name: NEW_BRAND.name, slug: brand.slug });
      await form.chrome.save();
      await sent;

      await expect(form.chrome.failure, 'ADM-12: the form says the brand was refused').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  // The refusal of an edit: 409 when the slug is taken, 500 when the server fails.
  for (const status of REFUSED_STATUSES) {
    test.describe(`when saving an edit is refused (${status})`, { tag: ['@negative', '@bug'] }, () => {
      test.use(withMocks(mock.fail('PUT', BRAND, status, { message: 'The brand could not be saved.' })));
      test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

      test('the admin is told the edited brand was not saved', async ({ adminBrands, apiMock }) => {
        knownBug('ADM-23', ADM_23, { absence: true });
        const form = await adminBrands.edit(brand.name);
        await expect(form.name.input).toHaveValue(brand.name);
        const refused = apiMock.waitForResponse('PUT', `/brands/${brand.id}`);

        await form.name.input.fill('Qa Lab Renamed');
        await form.chrome.save();
        expect((await refused).response.status(), 'the mocked refusal was sent').toBe(status);

        await expect(form.chrome.failure, 'ADM-23: a refused brand edit tells the admin').toBeVisible({ timeout: BUG_TIMEOUT });
      });
    });
  }
});
