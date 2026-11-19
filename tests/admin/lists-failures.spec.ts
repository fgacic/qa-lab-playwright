import { expect, mock, test, withMocks } from '@fixtures';
import type { AdminListName } from '@pages/admin/admin-lists';
import { LIST_ANSWERS, NO_MATCH, SEARCH_TERM } from '@support/admin-payloads';
import { appearsWithin, withLoggedFailure } from '@pages/admin/alerts';
import { SIGN_IN_PATH } from '@pages/admin/admin-sections';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

/**
 * Every back-office list, against an empty answer, a failing one and a refused session (LIST_ANSWERS: where each list
 * is fed, what its search box asks; the messages list has no search, and a search answers like the list, so `empty` serves both).
 */
const listNames = Object.keys(LIST_ANSWERS) as AdminListName[];

test.describe('Admin lists on empty and failing APIs (mocked back office)', { tag: ['@mocked'] }, () => {
  for (const name of listNames) {
    const answers = LIST_ANSWERS[name];
    const { feed: [method, path], empty, column } = answers;
    const search = 'search' in answers ? answers.search : undefined;
    test.describe(`${name}, empty`, () => {
      test.use({ adminListName: name, ...withMocks(mock.respond(method, path, empty)) });

      // `adminList` opens the page and returns once the list request has been answered (the empty mock).
      // An empty list is a table with its column titles and no rows, and no alert: nothing is "empty" about an error.
      test(`an empty ${name} list shows the table without rows`, async ({ adminList: list }) => {
        await expect(list.heading).toBeVisible();
        // The column titles are what an empty answer leaves on screen: the anchor that the table has been drawn.
        await expect(list.table.columnHeader(column)).toBeVisible();
        await expect(list.table.rows).toHaveCount(0);

        expect(await appearsWithin(list.failure), `no failure message appears on an empty ${name} list`).toBe(false);
      });
    });

    test.describe(`${name}, failing`, { tag: ['@negative', '@bug'] }, () => {
      test.use({ adminListName: name, ...withLoggedFailure(mock.fail(method, path, 500)) });

      test(`a failed ${name} list tells the admin`, async ({ adminList: list }) => {
        knownBug('ADM-07', 'a failed back-office list shows an empty table and no message, in every section.', { absence: true });
        await expect(list.heading).toBeVisible();

        // Any alert, or plain error text, will do: the pin does not prescribe the form or the wording. A healthy list shows none.
        await expect(list.failure, 'ADM-07: a failed list tells the admin').toBeVisible({ timeout: BUG_TIMEOUT });
      });
    });

    // The session the admin signed in with is refused (an expired or revoked token) while a list is open: the admin should be signed out and sent to the sign-in page.
    test.describe(`${name}, session expired`, { tag: ['@negative', '@bug'] }, () => {
      test.use({ adminListName: name, ...withLoggedFailure(mock.fail(method, path, 401, { message: 'Unauthorized' })) });

      test(`an expired session on the ${name} list sends the admin to the sign-in page`, async ({ adminList: list, page }) => {
        knownBug('ADM-22', 'a back-office list whose request is refused with 401 (an expired or revoked session) stays on its page with an empty table and says nothing: the admin is not sent to the sign-in page.');
        await expect(list.heading).toBeVisible();

        await expect(page, 'ADM-22: a refused session sends the admin to the sign-in page').toHaveURL(SIGN_IN_PATH, { timeout: BUG_TIMEOUT });
      });
    });

    // The lists below the dashboard that have no search (the orders list, the messages inbox) stop here.
    if (!search) continue;
    const [searchMethod, searchPath] = search;

    // A search whose answer is empty is not a failure: the table is drawn without rows, with its column titles, and says nothing.
    test.describe(`${name}, search finds nothing`, () => {
      test.use({ adminListName: name, ...withMocks(mock.respond(searchMethod, searchPath, empty)) });

      test(`a ${name} search with no match empties the table and raises no alert`, async ({ adminList: list }) => {
        await expect(list.table.rows.first(), 'the full list is shown before the search').toBeVisible();

        await list.search.searchFor(NO_MATCH);

        await expect(list.table.rows).toHaveCount(0);
        await expect(list.table.columnHeader(column)).toBeVisible();
        expect(await appearsWithin(list.failure), `no failure message appears when a ${name} search finds nothing`).toBe(false);
      });
    });

    test.describe(`${name}, search failing`, { tag: ['@negative', '@bug'] }, () => {
      test.use({ adminListName: name, ...withLoggedFailure(mock.fail(searchMethod, searchPath, 500)) });

      test(`a failed ${name} search tells the admin`, async ({ adminList: list, apiMock }) => {
        knownBug('ADM-18', 'a failed search in a back-office list (500) leaves the previous table on screen and says nothing, so the admin takes it for the result.', { absence: true });
        await expect(list.table.rows.first(), 'the full list is shown before the search').toBeVisible();
        const refused = apiMock.waitForResponse(searchMethod, searchPath);

        await list.search.searchFor(SEARCH_TERM);
        await refused;

        await expect(list.failure, 'ADM-18: a failed list search tells the admin').toBeVisible({ timeout: BUG_TIMEOUT });
      });
    });
  }
});
