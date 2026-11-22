import { expect, mock, test, withMocks } from '@fixtures';
import { ADMIN_MESSAGES } from '@pages/admin/alerts';
import { SEARCH_HIT, SEARCH_TERM, category, subcategory } from '@support/admin-payloads';
import { SAVEABLE, saveRefusalPins } from './save-refusals';

/** The slug of the category the search answers with. */
const SEARCH_HIT_SLUG = 'qa-lab-search-hit';
/** The subcategory the add form creates under the listed category. */
const NEW_SUBCATEGORY = { name: 'Qa Lab Sub', slug: 'qa-lab-sub' };
/** The slug an edit gives the category, and the one it gives a subcategory. */
const RENAMED_SLUG = 'qa-lab-renamed';
const RENAMED_SUBSLUG = `${RENAMED_SLUG}-sub`;

test.describe('Admin categories (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows each category with its slug', async ({ adminCategories }) => {
    await expect(adminCategories.table.row(category.name)).toContainText(category.slug);
  });

  test('searching sends the term and lists the matches', async ({ adminCategories, apiMock }) => {
    const match = { ...category, id: '01QALABCATEGORYHIT00000000', name: SEARCH_HIT, slug: SEARCH_HIT_SLUG };
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

  saveRefusalPins(SAVEABLE.category);
});
