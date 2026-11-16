import { expect, mock, test, withMocks } from '@fixtures';
import { ADMIN_MESSAGES } from '@pages/admin/alerts';
import { SEARCH_HIT, brand } from '@support/admin-payloads';
import { knownBug } from '@support/known-bug';

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

  test('Delete removes the brand', async ({ adminBrands, apiMock }) => {
    // Once deleted, the list the page reloads no longer has the brand.
    await apiMock.use(mock.respond('GET', '/brands', []));
    await expect(adminBrands.table.row(brand.name)).toBeVisible();
    const deleted = apiMock.waitForRequest('DELETE', `/brands/${brand.id}`);

    await adminBrands.table.delete(brand.name);

    await deleted;
    await expect(adminBrands.alert(ADMIN_MESSAGES.brandDeleted)).toBeVisible();
    await expect(adminBrands.table.row(brand.name)).toHaveCount(0);
  });

  test.describe('when the brand cannot be loaded', { tag: ['@negative', '@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', BRAND, 500)));

    test('the admin is told the brand could not be loaded', async ({ adminBrands, apiMock }) => {
      knownBug('ADM-14', 'an edit form whose record fails to load (500) opens empty, with no message: saving it would write blanks.', { absence: true });
      const failed = apiMock.waitForResponse('GET', BRAND);

      const form = await adminBrands.edit(brand.name);
      await failed;
      await expect(form.chrome.heading).toBeVisible();

      // Any alert will do: the pin does not prescribe the wording.
      await expect(form.chrome.alerts.first(), 'ADM-14: a failed brand load tells the admin').toBeVisible({ timeout: 2_000 });
    });
  });

  test.describe('when saving a brand is refused', { tag: ['@negative', '@bug'] }, () => {
    // The real API answers a taken slug with 409 and the reason keyed by field (POST /brands, probed on the self-hosted shop;
    // back-office.e2e.spec.ts asks the real backend the same).
    test.use(withMocks(mock.fail('POST', '/brands', 409, { slug: ['A brand already exists with this slug.'] })));

    test('the reason is shown', async ({ adminBrands, apiMock }) => {
      knownBug('ADM-12', 'a brand or category the API refuses to save (409, slug taken) leaves the form as it was: no message, no "saved", nothing.', { absence: true });
      const form = await adminBrands.add();
      const sent = apiMock.waitForRequest('POST', '/brands');

      await form.fillIn({ name: NEW_BRAND.name, slug: brand.slug });
      await form.chrome.save();
      await sent;

      await expect(form.chrome.alert('already exists'), 'ADM-12: the form says why the brand was refused').toBeVisible({ timeout: 2_000 });
    });
  });

  test.describe('when a brand is still in use', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('DELETE', BRAND, 409, { message: 'Seems like this brand is used elsewhere.' })));

    test('the reason is shown and the brand stays', async ({ adminBrands, apiMock }) => {
      // Were the page to reload the list or drop the row after the failed delete, this empty list would show it.
      await apiMock.use(mock.respond('GET', '/brands', []));
      await expect(adminBrands.table.row(brand.name)).toBeVisible();

      await adminBrands.table.delete(brand.name);

      await expect(adminBrands.alert('used elsewhere')).toBeVisible();
      await expect(adminBrands.alert(ADMIN_MESSAGES.brandDeleted)).toBeHidden();
      await expect(adminBrands.table.row(brand.name)).toBeVisible();
    });
  });
});
