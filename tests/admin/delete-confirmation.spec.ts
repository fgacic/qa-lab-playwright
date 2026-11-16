import { expect, test } from '@fixtures';
import type { AdminListName } from '@pages/admin/admin-lists';
import { brand, category, customer } from '@support/admin-payloads';
import { knownBug } from '@support/known-bug';

/** The four lists whose Delete is one click today (ADM-02): the row to delete, as the mocked list shows it, and the endpoint a delete would call. */
const deletable: { name: AdminListName; rowText: (product: { id: string }) => string; endpoint: RegExp }[] = [
  { name: 'products', rowText: (product) => product.id, endpoint: /^\/products\/[^/]+$/ },
  { name: 'brands', rowText: () => brand.name, endpoint: /^\/brands\/[^/]+$/ },
  { name: 'categories', rowText: () => category.name, endpoint: /^\/categories\/[^/]+$/ },
  { name: 'users', rowText: () => customer.email, endpoint: /^\/users\/[^/]+$/ },
];

test.describe('Admin delete (mocked back office)', { tag: ['@mocked'] }, () => {
  for (const { name, rowText, endpoint } of deletable) {
    test.describe(name, { tag: ['@negative', '@bug'] }, () => {
      test.use({ adminListName: name });

      test(`Delete asks for confirmation first (${name})`, async ({ adminList, backOffice, apiMock }) => {
        knownBug('ADM-02', 'Delete (products, brands, categories, users) acts on the first click, with no confirmation.');

        // `delete` answers a confirm() if one opens (dismissing it here) and returns its text, or undefined when the site deleted unasked.
        const question = await adminList.table.delete(rowText(backOffice.product), 'dismiss');

        expect(question, `ADM-02: Delete asks for confirmation before it deletes a ${name} record`).toBeDefined();
        // Dismissed means refused: nothing may have been deleted.
        await expect(apiMock.expectNoRequest('DELETE', endpoint), `ADM-02: dismissing the question deletes no ${name} record`).resolves.toBeUndefined();
      });
    });
  }
});
