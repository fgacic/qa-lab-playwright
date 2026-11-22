import { expect, mock, test } from '@fixtures';
import type { AdminBrandForm, AdminCategoryForm } from '@pages/admin/AdminForms';
import type { AdminListPage } from '@pages/admin/AdminListPage';
import { ADM_12, ADM_14, ADM_23, withLoggedFailure } from '@pages/admin/alerts';
import { REFUSED_STATUSES, brand, category } from '@support/admin-payloads';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

/** What differs between the two lists whose forms share the refusal pins below: where the record lives, and what an edit changes. */
interface Saveable {
  list: 'brands' | 'categories';
  entity: 'brand' | 'category';
  record: { id: string; name: string; slug: string };
  /** What a request for any one record of the list is called (the mocks' pattern), and for the one the edit form loads. */
  anyRecord: RegExp;
  loadsFrom: RegExp;
  /** What a new record is given, and the field an edit changes with its new value. */
  added: { name: string; slug: string };
  edited: { field: 'name' | 'slug'; value: string };
}

export const SAVEABLE = {
  brand: {
    list: 'brands', entity: 'brand', record: brand,
    anyRecord: /^\/brands\/[^/]+$/, loadsFrom: /^\/brands\/[^/]+$/,
    added: { name: 'Qa Lab New Brand', slug: brand.slug }, edited: { field: 'name', value: 'Qa Lab Renamed' },
  },
  category: {
    list: 'categories', entity: 'category', record: category,
    // The edit form loads a category from its tree endpoint, and saves it to the plain one.
    anyRecord: /^\/categories\/[^/]+$/, loadsFrom: /^\/categories\/tree\/[^/]+$/,
    added: { name: 'Qa Lab New Category', slug: category.slug }, edited: { field: 'slug', value: 'qa-lab-renamed' },
  },
} as const satisfies Record<string, Saveable>;

/**
 * The three known-bug pins brands and categories share, written once like delete.spec.ts does for Delete: ADM-14 (a record that
 * fails to load opens an empty form), ADM-12 (a refused new record says nothing) and ADM-23 (the same for an edit, in both of its
 * refusals). Called inside each list's describe, so the titles read as they did when each file wrote them out.
 * `adminList` is the list the `adminListName` option names; its forms are the two classes named here, hence the one cast.
 */
export function saveRefusalPins({ list, entity, record, anyRecord, loadsFrom, added, edited }: Saveable): void {
  type Form = AdminBrandForm | AdminCategoryForm;

  test.describe(`when the ${entity} cannot be loaded`, { tag: ['@negative', '@bug'] }, () => {
    test.use({ ...withLoggedFailure(mock.fail('GET', loadsFrom, 500)), adminListName: list });

    test(`the admin is told the ${entity} could not be loaded`, async ({ adminList, apiMock }) => {
      knownBug('ADM-14', ADM_14, { absence: true });
      const failed = apiMock.waitForResponse('GET', loadsFrom);

      const form = await (adminList as AdminListPage<Form>).edit(record.name);
      await failed;
      await expect(form.chrome.heading).toBeVisible();

      // Any alert, or plain error text, will do: the pin does not prescribe the form or the wording.
      await expect(form.chrome.failure, `ADM-14: a failed ${entity} load tells the admin`).toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe(`when saving a ${entity} is refused`, { tag: ['@negative', '@bug'] }, () => {
    // The real API answers a taken slug with 409 and the reason keyed by field (POST /brands, probed on the self-hosted shop;
    // back-office.e2e.spec.ts asks the real backend the same).
    test.use({ ...withLoggedFailure(mock.fail('POST', `/${list}`, 409, { slug: [`A ${entity} already exists with this slug.`] })), adminListName: list });

    test('the reason is shown', async ({ adminList, apiMock }) => {
      knownBug('ADM-12', ADM_12, { absence: true });
      const form = await (adminList as AdminListPage<Form>).add();
      const sent = apiMock.waitForRequest('POST', `/${list}`);

      await form.fillIn(added);
      await form.chrome.save();
      await sent;

      await expect(form.chrome.failure, `ADM-12: the form says the ${entity} was refused`).toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  // The refusal of an edit: 409 when the slug is taken, 500 when the server fails.
  for (const status of REFUSED_STATUSES) {
    test.describe(`when saving an edit is refused (${status})`, { tag: ['@negative', '@bug'] }, () => {
      test.use({ ...withLoggedFailure(mock.fail('PUT', anyRecord, status, { message: `The ${entity} could not be saved.` })), adminListName: list });

      test(`the admin is told the edited ${entity} was not saved`, async ({ adminList, apiMock }) => {
        knownBug('ADM-23', ADM_23, { absence: true });
        const form = await (adminList as AdminListPage<Form>).edit(record.name);
        await expect(form.name.input).toHaveValue(record.name);
        const refused = apiMock.waitForResponse('PUT', `/${list}/${record.id}`);

        await form[edited.field].input.fill(edited.value);
        await form.chrome.save();
        expect((await refused).response.status(), 'the mocked refusal was sent').toBe(status);

        await expect(form.chrome.failure, `ADM-23: a refused ${entity} edit tells the admin`).toBeVisible({ timeout: BUG_TIMEOUT });
      });
    });
  }
}
