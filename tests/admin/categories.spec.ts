import { expect, mock, test, withMocks } from '@fixtures';
import { ADM_14, ADMIN_MESSAGES, allowLoggedFailure } from '@pages/admin/alerts';
import { SEARCH_HIT, category } from '@support/admin-payloads';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

const CATEGORY = /^\/categories\/[^/]+$/;

test.describe('Admin categories (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows each category with its slug', async ({ adminCategories }) => {
    await expect(adminCategories.table.row(category.name)).toContainText(category.slug);
  });

  test('searching sends the term and lists the matches', async ({ adminCategories, apiMock }) => {
    const match = { ...category, id: '01QALABCATEGORYHIT00000000', name: SEARCH_HIT, slug: 'qa-lab-search-hit' };
    await apiMock.use(mock.respond('QUERY', '/categories/search', [match]));
    const sent = apiMock.waitForRequest('QUERY', '/categories/search');

    await adminCategories.search.searchFor('hit');

    expect((await sent).postDataJSON()).toEqual({ q: 'hit' });
    await expect(adminCategories.table.row(match.name)).toContainText(match.slug);
    await expect(adminCategories.table.row(category.name)).toHaveCount(0);
  });

  test('a new subcategory is saved under its parent', async ({ adminCategories, apiMock }) => {
    const form = await adminCategories.add();
    const created = apiMock.waitForRequest('POST', '/categories');

    await form.fillIn({ name: 'Qa Lab Sub', slug: 'qa-lab-sub', parent: category.name });
    await form.chrome.save();

    expect((await created).postDataJSON()).toMatchObject({ name: 'Qa Lab Sub', slug: 'qa-lab-sub', parent_id: category.id });
    await expect(form.chrome.alert(ADMIN_MESSAGES.categorySaved)).toBeVisible();
  });

  test('name and slug are required', { tag: ['@negative'] }, async ({ adminCategories }) => {
    const form = await adminCategories.add();

    await form.chrome.save();

    await expect(form.chrome.required('Name')).toBeVisible();
    await expect(form.chrome.required('Slug')).toBeVisible();
  });

  test('editing loads the category and saves the change', async ({ adminCategories, apiMock }) => {
    const form = await adminCategories.edit(category.name);
    await expect(form.name).toHaveValue(category.name);
    const saved = apiMock.waitForRequest('PUT', `/categories/${category.id}`);

    await form.slug.fill('qa-lab-renamed');
    await form.chrome.save();

    expect((await saved).postDataJSON()).toMatchObject({ name: category.name, slug: 'qa-lab-renamed' });
    await expect(form.chrome.alert(ADMIN_MESSAGES.categorySaved)).toBeVisible();
  });

  test('Delete removes the category', async ({ adminCategories, apiMock }) => {
    // Once deleted, the list the page reloads no longer has the category.
    await apiMock.use(mock.respond('GET', '/categories', []));
    await expect(adminCategories.table.row(category.name)).toBeVisible();
    const deleted = apiMock.waitForRequest('DELETE', `/categories/${category.id}`);

    await adminCategories.table.delete(category.name);

    await deleted;
    await expect(adminCategories.alert(ADMIN_MESSAGES.categoryDeleted)).toBeVisible();
    await expect(adminCategories.table.row(category.name)).toHaveCount(0);
  });

  test.describe('when a category is still in use', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('DELETE', CATEGORY, 409, { message: 'Seems like this category is used elsewhere.' })));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the reason is shown and the category stays', async ({ adminCategories, apiMock }) => {
      // Were the page to reload the list or drop the row after the failed delete, this empty list would show it.
      await apiMock.use(mock.respond('GET', '/categories', []));
      await expect(adminCategories.table.row(category.name)).toBeVisible();

      await adminCategories.table.delete(category.name);

      await expect(adminCategories.alert('used elsewhere')).toBeVisible();
      await expect(adminCategories.alert(ADMIN_MESSAGES.categoryDeleted)).toBeHidden();
      await expect(adminCategories.table.row(category.name)).toBeVisible();
    });
  });

  test.describe('when saving a category is refused', { tag: ['@negative', '@bug'] }, () => {
    test.use(withMocks(mock.fail('POST', '/categories', 409, { slug: ['A category already exists with this slug.'] })));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the reason is shown', async ({ adminCategories, apiMock }) => {
      knownBug('ADM-12', 'a brand or category the API refuses to save (409, slug taken) leaves the form as it was: no message, no "saved", nothing.', { absence: true });
      const form = await adminCategories.add();
      const sent = apiMock.waitForRequest('POST', '/categories');

      await form.fillIn({ name: 'Qa Lab New Category', slug: category.slug });
      await form.chrome.save();
      await sent;

      await expect(form.chrome.alert('already exists'), 'ADM-12: the form says why the category was refused').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('when deleting a category fails on the server', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('DELETE', CATEGORY, 500)));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the failure is shown and the category stays', async ({ adminCategories, apiMock }) => {
      // Were the page to reload the list or drop the row after the failed delete, this empty list would show it.
      await apiMock.use(mock.respond('GET', '/categories', []));
      await expect(adminCategories.table.row(category.name)).toBeVisible();

      await adminCategories.table.delete(category.name);

      await expect(adminCategories.failure).toBeVisible();
      await expect(adminCategories.alert(ADMIN_MESSAGES.categoryDeleted)).toBeHidden();
      await expect(adminCategories.table.row(category.name)).toBeVisible();
    });
  });

  test.describe('when the category cannot be loaded', { tag: ['@negative', '@bug'] }, () => {
    // The edit form loads the category from its tree endpoint.
    test.use(withMocks(mock.fail('GET', /^\/categories\/tree\/[^/]+$/, 500)));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the admin is told the category could not be loaded', async ({ adminCategories, apiMock }) => {
      knownBug('ADM-14', ADM_14, { absence: true });
      const failed = apiMock.waitForResponse('GET', /^\/categories\/tree\/[^/]+$/);

      const form = await adminCategories.edit(category.name);
      await failed;
      await expect(form.chrome.heading).toBeVisible();

      // Any alert, or plain error text, will do: the pin does not prescribe the form or the wording.
      await expect(form.chrome.failure, 'ADM-14: a failed category load tells the admin').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });
});
