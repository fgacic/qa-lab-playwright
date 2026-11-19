import { expect, mock, test, withMocks } from '@fixtures';
import { ADM_12, ADM_14, ADM_23, ADMIN_MESSAGES, withLoggedFailure } from '@pages/admin/alerts';
import { REFUSED_STATUSES, SEARCH_HIT, SEARCH_TERM, category, subcategory } from '@support/admin-payloads';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

/** The subcategory the add form creates under the listed category. */
const NEW_SUBCATEGORY = { name: 'Qa Lab Sub', slug: 'qa-lab-sub' };
/** The name given to a category whose save is refused. */
const NEW_CATEGORY_NAME = 'Qa Lab New Category';
/** The slug an edit gives the category, and the one it gives a subcategory. */
const RENAMED_SLUG = 'qa-lab-renamed';
const RENAMED_SUBSLUG = `${RENAMED_SLUG}-sub`;

test.describe('Admin categories (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows each category with its slug', async ({ adminCategories }) => {
    await expect(adminCategories.table.row(category.name)).toContainText(category.slug);
  });

  test('searching sends the term and lists the matches', async ({ adminCategories, apiMock }) => {
    const match = { ...category, id: '01QALABCATEGORYHIT00000000', name: SEARCH_HIT, slug: 'qa-lab-search-hit' };
    await apiMock.use(mock.respond('QUERY', '/categories/search', [match]));
    const sent = apiMock.waitForRequest('QUERY', '/categories/search');

    await adminCategories.search.searchFor(SEARCH_TERM);

    expect((await sent).postDataJSON()).toEqual({ q: SEARCH_TERM });
    await expect(adminCategories.table.row(match.name)).toContainText(match.slug);
    await expect(adminCategories.table.row(category.name)).toHaveCount(0);
  });

  test('a new subcategory is saved under its parent', async ({ adminCategories, apiMock }) => {
    const form = await adminCategories.add();
    const created = apiMock.waitForRequest('POST', '/categories');

    await form.fillIn({ ...NEW_SUBCATEGORY, parent: category.name });
    await form.chrome.save();

    expect((await created).postDataJSON()).toMatchObject({ ...NEW_SUBCATEGORY, parent_id: category.id });
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
    await expect(form.name.input).toHaveValue(category.name);
    const saved = apiMock.waitForRequest('PUT', `/categories/${category.id}`);

    await form.slug.input.fill(RENAMED_SLUG);
    await form.chrome.save();

    expect((await saved).postDataJSON()).toMatchObject({ name: category.name, slug: RENAMED_SLUG, parent_id: null });
    await expect(form.chrome.alert(ADMIN_MESSAGES.categorySaved)).toBeVisible();
  });

  test.describe('a subcategory', () => {
    // The edit form loads a category from its tree endpoint; the list shows both rows.
    test.use(withMocks(mock.respond('GET', '/categories', [category, subcategory]), mock.respond('GET', /^\/categories\/tree\/[^/]+$/, subcategory)));

    test('is edited under its parent, which stays selected and is sent back', async ({ adminCategories, apiMock }) => {
      const form = await adminCategories.edit(subcategory.name);
      await expect(form.name.input).toHaveValue(subcategory.name);
      // The options are loaded before the selection is judged: what could be missing is the selection, not the list.
      await expect(form.parent.getByRole('option', { name: category.name })).toBeAttached();
      await expect(form.parent, 'the parent is preselected').toHaveValue(category.id);
      const saved = apiMock.waitForRequest('PUT', `/categories/${subcategory.id}`);

      await form.slug.input.fill(RENAMED_SUBSLUG);
      await form.chrome.save();

      expect((await saved).postDataJSON()).toMatchObject({ name: subcategory.name, slug: RENAMED_SUBSLUG, parent_id: category.id });
      await expect(form.chrome.alert(ADMIN_MESSAGES.categorySaved)).toBeVisible();
    });
  });

  test.describe('when saving a category is refused', { tag: ['@negative', '@bug'] }, () => {
    test.use(withLoggedFailure(mock.fail('POST', '/categories', 409, { slug: ['A category already exists with this slug.'] })));

    test('the reason is shown', async ({ adminCategories, apiMock }) => {
      knownBug('ADM-12', ADM_12, { absence: true });
      const form = await adminCategories.add();
      const sent = apiMock.waitForRequest('POST', '/categories');

      await form.fillIn({ name: NEW_CATEGORY_NAME, slug: category.slug });
      await form.chrome.save();
      await sent;

      await expect(form.chrome.failure, 'ADM-12: the form says the category was refused').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('when the category cannot be loaded', { tag: ['@negative', '@bug'] }, () => {
    // The edit form loads the category from its tree endpoint.
    test.use(withLoggedFailure(mock.fail('GET', /^\/categories\/tree\/[^/]+$/, 500)));

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

  // The refusal of an edit: 409 when the slug is taken, 500 when the server fails.
  for (const status of REFUSED_STATUSES) {
    test.describe(`when saving an edit is refused (${status})`, { tag: ['@negative', '@bug'] }, () => {
      test.use(withLoggedFailure(mock.fail('PUT', /^\/categories\/[^/]+$/, status, { message: 'The category could not be saved.' })));

      test('the admin is told the edited category was not saved', async ({ adminCategories, apiMock }) => {
        knownBug('ADM-23', ADM_23, { absence: true });
        const form = await adminCategories.edit(category.name);
        await expect(form.name.input).toHaveValue(category.name);
        const refused = apiMock.waitForResponse('PUT', `/categories/${category.id}`);

        await form.slug.input.fill(RENAMED_SLUG);
        await form.chrome.save();
        expect((await refused).response.status(), 'the mocked refusal was sent').toBe(status);

        await expect(form.chrome.failure, 'ADM-23: a refused category edit tells the admin').toBeVisible({ timeout: BUG_TIMEOUT });
      });
    });
  }
});
