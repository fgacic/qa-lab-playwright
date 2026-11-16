import { expect, mock, test, withMocks } from '@fixtures';
import { ADM_14, ADMIN_MESSAGES, allowLoggedFailure } from '@pages/admin/alerts';
import { customer, paginated } from '@support/admin-payloads';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

/** What the SPA logs after the API accepts a new user (ADM-21): its own `ERROR` prefix, as the back office runs in Chromium only. The suite-wide allowance (console-guard.ts) reads the error itself. */
const NEW_USER_ERROR = /^ERROR\b/;

/** The user the add form is filled in with: only the required fields, the others stay empty and the form accepts that. */
const newUser = { firstName: 'Newly', lastName: 'Added', dateOfBirth: '1991-02-03', street: 'Test Street 2', city: 'Testville', country: 'NL', email: 'newly.added@example.com' };

test.describe('Admin users (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows name and email', async ({ adminUsers }) => {
    await expect(adminUsers.table.row(customer.email)).toContainText(`${customer.first_name} ${customer.last_name}`);
  });

  test('searching sends the term and lists the matches', async ({ adminUsers, apiMock }) => {
    // The answer differs from the full list, so a table that shows it has really been replaced.
    const match = { ...customer, id: '01QALABUSERHIT0000000000', first_name: 'Searched', email: 'searched.hit@example.com' };
    await apiMock.use(mock.respond('QUERY', '/users/search', paginated([match])));
    const sent = apiMock.waitForRequest('QUERY', '/users/search');

    await adminUsers.search.searchFor('searched');

    expect((await sent).postDataJSON()).toMatchObject({ q: 'searched' });
    await expect(adminUsers.table.row(match.email)).toContainText(match.first_name);
    await expect(adminUsers.table.row(customer.email)).toHaveCount(0);
  });

  test('a new user is saved with what was entered', async ({ adminUsers, apiMock }) => {
    const form = await adminUsers.add();
    const created = apiMock.waitForRequest('POST', '/users/register');

    await form.fillIn(newUser);
    await form.chrome.save();

    expect((await created).postDataJSON()).toMatchObject({ first_name: newUser.firstName, last_name: newUser.lastName, dob: newUser.dateOfBirth, email: newUser.email, address: { street: newUser.street, city: newUser.city, country: newUser.country } });
    await expect(form.chrome.alert(ADMIN_MESSAGES.userSaved)).toBeVisible();
  });

  test('a new user needs the required fields', { tag: ['@negative'] }, async ({ adminUsers }) => {
    const form = await adminUsers.add();
    await expect(form.chrome.heading).toHaveText('Add User');

    await form.chrome.save();

    // Postal code, State, Phone and Password are optional on this form, so they are not listed.
    for (const field of ['First Name', 'Last Name', 'Date of birth', 'Street', 'City', 'Country', 'Email']) {
      await expect(form.chrome.required(field), field).toBeVisible();
    }
  });

  test('editing loads the user, including the account flags, and saves the change', async ({ adminUsers, apiMock }) => {
    const form = await adminUsers.edit(customer.email);
    await expect(form.email).toHaveValue(customer.email);
    await expect(form.enabled).toBeChecked();
    await expect(form.failedLoginAttempts).toHaveValue('0');
    const saved = apiMock.waitForRequest('PUT', `/users/${customer.id}`);

    await form.firstName.fill('Renamed');
    await form.enabled.uncheck();
    await form.chrome.save();

    expect((await saved).postDataJSON()).toMatchObject({ first_name: 'Renamed', enabled: false, email: customer.email });
    await expect(form.chrome.alert(ADMIN_MESSAGES.userSaved)).toBeVisible();
  });

  test('Delete removes the user', async ({ adminUsers, apiMock }) => {
    // Once deleted, the list the page reloads no longer has the user.
    await apiMock.use(mock.respond('GET', '/users', paginated([])));
    await expect(adminUsers.table.row(customer.email)).toBeVisible();
    const deleted = apiMock.waitForRequest('DELETE', `/users/${customer.id}`);

    await adminUsers.table.delete(customer.email);

    await deleted;
    await expect(adminUsers.feedback.filter({ hasText: ADMIN_MESSAGES.userDeleted })).toBeVisible();
    await expect(adminUsers.table.row(customer.email)).toHaveCount(0);
  });

  test.describe('when a user is still in use', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('DELETE', /^\/users\/[^/]+$/, 409, { message: 'Seems like this user is used elsewhere.' })));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the reason is shown and the user stays', async ({ adminUsers, apiMock }) => {
      // Were the page to reload the list or drop the row after the failed delete, this empty list would show it.
      await apiMock.use(mock.respond('GET', '/users', paginated([])));
      await expect(adminUsers.table.row(customer.email)).toBeVisible();

      await adminUsers.table.delete(customer.email);

      await expect(adminUsers.alert('used elsewhere')).toBeVisible();
      await expect(adminUsers.alert(ADMIN_MESSAGES.userDeleted)).toBeHidden();
      await expect(adminUsers.table.row(customer.email)).toBeVisible();
    });
  });

  test.describe('when deleting a user fails on the server', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('DELETE', /^\/users\/[^/]+$/, 500)));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the failure is shown and the user stays', async ({ adminUsers, apiMock }) => {
      // Were the page to reload the list or drop the row after the failed delete, this empty list would show it.
      await apiMock.use(mock.respond('GET', '/users', paginated([])));
      await expect(adminUsers.table.row(customer.email)).toBeVisible();

      await adminUsers.table.delete(customer.email);

      await expect(adminUsers.failure).toBeVisible();
      await expect(adminUsers.alert(ADMIN_MESSAGES.userDeleted)).toBeHidden();
      await expect(adminUsers.table.row(customer.email)).toBeVisible();
    });
  });

  test('the password of a new user is typed into a masked field', { tag: ['@bug'] }, async ({ adminUsers }) => {
    knownBug('ADM-17', 'the admin user form shows the password in clear text (an <input type="text">).');
    const form = await adminUsers.add();
    await expect(form.chrome.heading).toHaveText('Add User');
    await expect(form.password).toBeVisible();

    await expect(form.password, 'ADM-17: the password field is masked').toHaveAttribute('type', 'password', { timeout: BUG_TIMEOUT });
  });

  test('saving a new user raises no application error', { tag: ['@bug'] }, async ({ adminUsers, page }) => {
    knownBug('ADM-21', 'after the API accepts a new user (201) the SPA throws an unhandled Angular error (NG01002, "Must supply a value for form control") although the form says "User saved!".');
    const form = await adminUsers.add();
    // Listening before the save: the error is raised while the save is answered, and a listener started afterwards would miss it.
    const raised = page.waitForEvent('console', { predicate: (message) => message.type() === 'error' && NEW_USER_ERROR.test(message.text()), timeout: BUG_TIMEOUT }).then(() => true, () => false);

    await form.fillIn(newUser);
    await form.chrome.save();
    await expect(form.chrome.alert(ADMIN_MESSAGES.userSaved)).toBeVisible();

    expect(await raised, 'ADM-21: saving a new user raises no application error').toBe(false);
  });

  test.describe('when the new user is refused', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('POST', '/users/register', 422, { email: ['A customer with this email address already exists.'] })));

    test('the API error is shown and nothing is reported as saved', async ({ adminUsers }) => {
      const form = await adminUsers.add();

      await form.fillIn({ ...newUser, email: customer.email });
      await form.chrome.save();

      await expect(form.chrome.alert('A customer with this email address already exists.')).toBeVisible();
      await expect(form.chrome.alert(ADMIN_MESSAGES.userSaved)).toBeHidden();
    });
  });

  test.describe('when the user cannot be loaded', { tag: ['@negative', '@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', /^\/users\/[^/]+$/, 500)));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the admin is told the user could not be loaded', async ({ adminUsers, apiMock }) => {
      knownBug('ADM-14', ADM_14, { absence: true });
      const failed = apiMock.waitForResponse('GET', /^\/users\/[^/]+$/);

      const form = await adminUsers.edit(customer.email);
      await failed;
      await expect(form.chrome.heading).toBeVisible();

      // Any alert, or plain error text, will do: the pin does not prescribe the form or the wording.
      await expect(form.chrome.failure, 'ADM-14: a failed user load tells the admin').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('when the email is already taken', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('PUT', /^\/users\/[^/]+$/, 422, { email: ['A customer with this email address already exists.'] })));

    test('the API error is shown', async ({ adminUsers }) => {
      const form = await adminUsers.edit(customer.email);
      await expect(form.email).toHaveValue(customer.email);

      await form.chrome.save();

      await expect(form.chrome.alert('A customer with this email address already exists.')).toBeVisible();
    });
  });
});
