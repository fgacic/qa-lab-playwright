import { expect, mock, test } from '@fixtures';
import { withLoggedFailure } from '@pages/admin/alerts';
import { DELETABLE, deletedMessage } from '@support/admin-deletable';
import { LIST_ANSWERS } from '@support/admin-payloads';

/**
 * What Delete does on the four lists that have one, answered by the mocked back office: the record goes, the API's reason
 * is shown when the record is in use (409), a failure is shown when the server fails (500). What Delete asks first is
 * delete-confirmation.spec.ts (ADM-02).
 */
for (const { list, entity, row, path, anyRecord } of DELETABLE) {
  const [feedMethod, feedPath] = LIST_ANSWERS[list].feed;

  test.describe(`Admin delete: ${list} (mocked back office)`, { tag: ['@mocked'] }, () => {
    test.use({ adminListName: list });

    test(`Delete removes the ${entity}`, async ({ adminList, apiMock }) => {
      // Once deleted, the list the page reloads no longer has the record.
      await apiMock.use(mock.respond(feedMethod, feedPath, LIST_ANSWERS[list].empty));
      await expect(adminList.table.row(row)).toBeVisible();
      const deleted = apiMock.waitForRequest('DELETE', path);

      await adminList.table.delete(row);

      await deleted;
      await expect(adminList.alert(deletedMessage(entity))).toBeVisible();
      await expect(adminList.table.row(row)).toHaveCount(0);
    });

    test.describe(`when the ${entity} is still in use`, { tag: ['@negative'] }, () => {
      test.use(withLoggedFailure(mock.fail('DELETE', anyRecord, 409, { message: `Seems like this ${entity} is used elsewhere.` })));

      test(`the reason is shown and the ${entity} stays`, async ({ adminList, apiMock }) => {
        // Were the page to reload the list or drop the row after the failed delete, this empty list would show it.
        await apiMock.use(mock.respond(feedMethod, feedPath, LIST_ANSWERS[list].empty));
        await expect(adminList.table.row(row)).toBeVisible();

        await adminList.table.delete(row);

        await expect(adminList.alert('used elsewhere')).toBeVisible();
        await expect(adminList.alert(deletedMessage(entity))).toBeHidden();
        await expect(adminList.table.row(row)).toBeVisible();
      });
    });

    test.describe(`when deleting the ${entity} fails on the server`, { tag: ['@negative'] }, () => {
      test.use(withLoggedFailure(mock.fail('DELETE', anyRecord, 500)));

      test(`the failure is shown and the ${entity} stays`, async ({ adminList, apiMock }) => {
        // Were the page to reload the list or drop the row after the failed delete, this empty list would show it.
        await apiMock.use(mock.respond(feedMethod, feedPath, LIST_ANSWERS[list].empty));
        await expect(adminList.table.row(row)).toBeVisible();

        await adminList.table.delete(row);

        await expect(adminList.failure).toBeVisible();
        await expect(adminList.alert(deletedMessage(entity))).toBeHidden();
        await expect(adminList.table.row(row)).toBeVisible();
      });
    });
  });
}
