import { expect, test } from '@fixtures';
import { DELETABLE } from '@support/admin-deletable';
import { knownBug } from '@support/known-bug';

test.describe('Admin delete confirmation (mocked back office)', { tag: ['@mocked'] }, () => {
  for (const { list, row, anyRecord } of DELETABLE) {
    test.describe(list, { tag: ['@negative', '@bug'] }, () => {
      test.use({ adminListName: list });

      test(`Delete asks for confirmation first (${list})`, async ({ adminList, apiMock }) => {
        knownBug('ADM-02', 'Delete (products, brands, categories, users) acts on the first click, with no confirmation.');

        // Nothing confirms the click: a native confirm() is dismissed, an in-page dialog is left unanswered.
        await adminList.table.deleteWithoutConfirming(row);

        // Whatever form the question takes (or none), an unconfirmed click may not have deleted the record.
        await expect(apiMock.expectNoRequest('DELETE', anyRecord), `ADM-02: Delete sends no DELETE for a ${list} record before it is confirmed`).resolves.toBeUndefined();
      });
    });
  }
});
