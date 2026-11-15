import { expect, mock, test, withMocks } from '@fixtures';
import { ORDER_STATUSES } from '@pages/admin/AdminPages';
import { contactMessage, customer, messageReply, orderPayment, paginated } from '@support/admin-payloads';
import { knownBug } from '@support/known-bug';

test.describe('Admin orders (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows each order with status and total', async ({ adminOrders, backOffice }) => {
    const row = adminOrders.table.row(backOffice.order.invoice_number);

    await expect(row).toContainText(backOffice.order.status);
    await expect(row).toContainText(`$${backOffice.order.total.toFixed(2)}`);
  });

  test('searching sends the term and lists the matches', async ({ adminOrders, backOffice, apiMock }) => {
    // The answer differs from the full list, so a table that shows it has really been replaced.
    const match = { ...backOffice.order, id: '01QALABORDERHIT00000000000', invoice_number: 'INV-2026999991' };
    await apiMock.use(mock.respond('QUERY', '/invoices/search', paginated([match])));
    const sent = apiMock.waitForRequest('QUERY', '/invoices/search');

    await adminOrders.search.searchFor('INV-2026999991');

    expect((await sent).postDataJSON()).toMatchObject({ q: 'INV-2026999991' });
    await expect(adminOrders.table.row(match.invoice_number)).toBeVisible();
    await expect(adminOrders.table.row(backOffice.order.invoice_number)).toHaveCount(0);
  });

  test('an order shows its invoice, payment and lines', async ({ adminOrders, backOffice }) => {
    const order = await adminOrders.edit(backOffice.order.invoice_number);

    await expect(order.invoiceNumber).toHaveValue(backOffice.order.invoice_number);
    await expect(order.total).toHaveValue(`$ ${backOffice.order.total.toFixed(2)}`);
    await expect(order.paymentMethod).toHaveValue(orderPayment.label);
    await expect(order.billingCity).toHaveValue(backOffice.order.billing_city);
    await expect(order.lines).toHaveCount(1);
    await expect(order.lines.first()).toContainText(backOffice.product.name);
  });

  // The order's current status is not offered as an option, so every other status is set in turn.
  for (const status of ORDER_STATUSES.filter((s) => s !== 'AWAITING_FULFILLMENT')) {
    test(`changing the status to ${status} saves it and confirms`, async ({ adminOrders, backOffice, apiMock }) => {
      const order = await adminOrders.edit(backOffice.order.invoice_number);
      await expect(order.status).toHaveValue(backOffice.order.status);
      const sent = apiMock.waitForRequest('PUT', /^\/invoices\/[^/]+\/status$/);

      await order.updateStatus(status);

      expect((await sent).postDataJSON()).toMatchObject({ status });
      await expect(order.feedback.filter({ hasText: 'Status updated!' })).toBeVisible();
    });
  }

  test.describe('when the status update fails', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('PUT', /^\/invoices\/[^/]+\/status$/, 500)));

    test('the admin is told the status was not saved', async ({ adminOrders, backOffice }) => {
      const order = await adminOrders.edit(backOffice.order.invoice_number);
      await expect(order.status).toHaveValue(backOffice.order.status);

      await order.updateStatus('SHIPPED');

      // The page shows the raw HTTP error; the mocked 500 is what must be in it.
      await expect(order.feedback.filter({ hasText: '500 Internal Server Error' })).toBeVisible();
      await expect(order.feedback.filter({ hasText: 'Status updated!' })).toBeHidden();
    });
  });
});

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

    // Only the required fields: Postal code, State, Phone and Password stay empty and the form accepts that.
    await form.fillIn({ firstName: 'Newly', lastName: 'Added', dateOfBirth: '1991-02-03', street: 'Test Street 2', city: 'Testville', country: 'NL', email: 'newly.added@example.com' });
    await form.chrome.save();

    expect((await created).postDataJSON()).toMatchObject({ first_name: 'Newly', last_name: 'Added', dob: '1991-02-03', email: 'newly.added@example.com', address: { street: 'Test Street 2', city: 'Testville', country: 'NL' } });
    await expect(form.chrome.alert('User saved!')).toBeVisible();
  });

  test('a new user needs the required fields', { tag: ['@negative'] }, async ({ adminUsers }) => {
    const form = await adminUsers.add();
    await expect(form.chrome.heading).toHaveText('Add User');

    await form.chrome.save();

    // Postal code, State, Phone and Password are optional on this form, so they are not listed.
    for (const message of ['First Name is required', 'Last Name is required', 'Date of birth is required', 'Street is required', 'City is required', 'Country is required', 'Email is required']) {
      await expect(form.chrome.alert(message)).toBeVisible();
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
    await expect(form.chrome.alert('User saved!')).toBeVisible();
  });

  test('Delete removes the user', async ({ adminUsers, apiMock }) => {
    // Once deleted, the list the page reloads no longer has the user.
    await apiMock.use(mock.respond('GET', '/users', paginated([])));
    await expect(adminUsers.table.row(customer.email)).toBeVisible();
    const deleted = apiMock.waitForRequest('DELETE', `/users/${customer.id}`);

    await adminUsers.table.delete(customer.email);

    await deleted;
    await expect(adminUsers.feedback.filter({ hasText: 'User deleted.' })).toBeVisible();
    await expect(adminUsers.table.row(customer.email)).toHaveCount(0);
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

test.describe('Admin messages (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the inbox lists who wrote, about what, and the status', async ({ adminMessages }) => {
    await expect(adminMessages.table.row(contactMessage.name)).toContainText(contactMessage.subject);
    await expect(adminMessages.table.statusBadge(contactMessage.status, contactMessage.name)).toBeVisible();
  });

  test('a message opens with its text, and its status is saved on change', async ({ adminMessages, apiMock }) => {
    const message = await adminMessages.details(contactMessage.name);
    await expect(message.text(contactMessage.message)).toBeVisible();
    const sent = apiMock.waitForRequest('PUT', `/messages/${contactMessage.id}/status`);

    await message.setStatus('IN_PROGRESS');

    expect((await sent).postDataJSON()).toEqual({ status: 'IN_PROGRESS' });
  });

  test.describe('after a reply', () => {
    // The page asks for the message again once the reply is saved: the second answer carries it.
    test.use(withMocks(mock.sequence('GET', /^\/messages\/[^/]+$/, { status: 200, json: contactMessage }, { status: 200, json: { ...contactMessage, replies: [messageReply('A mocked admin reply.')] } })));

    test('a reply is sent, shown under the message and the box is emptied', async ({ adminMessages, apiMock }) => {
      const message = await adminMessages.details(contactMessage.name);
      await expect(message.text(contactMessage.message)).toBeVisible();
      await expect(message.text('A mocked admin reply.')).toHaveCount(0);
      const sent = apiMock.waitForRequest('POST', `/messages/${contactMessage.id}/reply`);

      await message.reply('A mocked admin reply.');

      expect((await sent).postDataJSON()).toEqual({ message: 'A mocked admin reply.' });
      await expect(message.text('A mocked admin reply.')).toBeVisible();
      await expect(message.replyBox).toHaveValue('');
    });
  });

  test.describe('when the reply is not saved', { tag: ['@negative', '@bug'] }, () => {
    test.use(withMocks(mock.fail('POST', /^\/messages\/[^/]+\/reply$/, 500)));

    test('the admin is told the reply was not sent', async ({ adminMessages, apiMock }) => {
      knownBug('ADM-10', 'a reply the API refuses (500) leaves the page as it was: no message, and the typed text stays in the box as if nothing happened.');
      const message = await adminMessages.details(contactMessage.name);
      const sent = apiMock.waitForRequest('POST', `/messages/${contactMessage.id}/reply`);

      await message.reply('A reply that fails.');
      await sent;

      await expect(message.feedback.first(), 'ADM-10: a failed reply tells the admin').toBeVisible({ timeout: 2_000 });
    });
  });

  test.describe('when the status is not saved', { tag: ['@negative', '@bug'] }, () => {
    test.use(withMocks(mock.fail('PUT', /^\/messages\/[^/]+\/status$/, 500)));

    test('the admin is told the status was not saved', async ({ adminMessages, apiMock }) => {
      knownBug('ADM-11', 'a message status the API refuses to save (500) is not reported: the picker keeps showing the new status as if it had been saved.');
      const message = await adminMessages.details(contactMessage.name);
      const sent = apiMock.waitForRequest('PUT', `/messages/${contactMessage.id}/status`);

      await message.setStatus('RESOLVED');
      await sent;

      await expect(message.feedback.first(), 'ADM-11: a failed status change tells the admin').toBeVisible({ timeout: 2_000 });
    });
  });

  test('an empty reply is stopped by the form', { tag: ['@negative', '@bug'] }, async ({ adminMessages, apiMock }) => {
    knownBug('ADM-06', 'an empty admin reply is sent to the API ({"message":""}) instead of being validated.');
    const message = await adminMessages.details(contactMessage.name);

    await message.replyButton.click();

    await expect(message.feedback.filter({ hasText: /required/i }), 'ADM-06: the form says a reply is required').toBeVisible({ timeout: 2_000 });
    expect(apiMock.requestsTo('POST', `/messages/${contactMessage.id}/reply`), 'ADM-06: no empty reply is sent').toBe(0);
  });
});
