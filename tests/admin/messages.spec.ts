import { expect, mock, test, withMocks } from '@fixtures';
import { ADM_14, allowLoggedFailure } from '@pages/admin/alerts';
import { contactMessage, messageReply } from '@support/admin-payloads';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

test.describe('Admin messages (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the inbox lists who wrote, about what, and the status', async ({ adminMessages }) => {
    await expect(adminMessages.table.row(contactMessage.name)).toContainText(contactMessage.subject);
    await expect(adminMessages.table.statusBadge(contactMessage.status, contactMessage.name)).toBeVisible();
  });

  test('a message opens with its text', async ({ adminMessages }) => {
    const message = await adminMessages.details(contactMessage.name);

    await expect(message.text(contactMessage.message)).toBeVisible();
    await expect(message.status).toHaveValue(contactMessage.status);
  });

  test.describe('after the status is saved', () => {
    // The page asks for the message again on a reload, and the API now has the new status: a reload that shows it read it back.
    test.use(withMocks(mock.sequence('GET', /^\/messages\/[^/]+$/, { status: 200, json: contactMessage }, { status: 200, json: { ...contactMessage, status: 'IN_PROGRESS' } })));

    test('a status change is saved on change and is still there after a reload', async ({ adminMessages, apiMock }) => {
      const message = await adminMessages.details(contactMessage.name);
      await expect(message.status).toHaveValue(contactMessage.status);
      const sent = apiMock.waitForRequest('PUT', `/messages/${contactMessage.id}/status`);

      await message.setStatus('IN_PROGRESS');

      expect((await sent).postDataJSON()).toEqual({ status: 'IN_PROGRESS' });
      const reread = apiMock.waitForResponse('GET', /^\/messages\/[^/]+$/);
      await message.page.reload();
      await reread;
      await expect(message.status).toHaveValue('IN_PROGRESS');
    });
  });

  test.describe('after a reply', () => {
    // The page asks for the message again once the reply is saved. The second answer carries a reply
    // worded differently from what is typed, so a reply that shows can only have come from that refetch.
    const typed = 'A mocked admin reply.';
    const stored = 'The reply as the API stored it.';
    test.use(withMocks(mock.sequence('GET', /^\/messages\/[^/]+$/, { status: 200, json: contactMessage }, { status: 200, json: { ...contactMessage, replies: [messageReply(stored)] } })));

    test('a reply is sent, shown under the message and the box is emptied', async ({ adminMessages, apiMock }) => {
      const message = await adminMessages.details(contactMessage.name);
      await expect(message.text(contactMessage.message)).toBeVisible();
      await expect(message.text(stored)).toHaveCount(0);
      const sent = apiMock.waitForRequest('POST', `/messages/${contactMessage.id}/reply`);

      await message.reply(typed);

      expect((await sent).postDataJSON()).toEqual({ message: typed });
      await expect(message.text(stored)).toBeVisible();
      await expect(message.replyBox).toHaveValue('');
    });
  });

  test.describe('when the reply is not saved', { tag: ['@negative', '@bug'] }, () => {
    test.use(withMocks(mock.fail('POST', /^\/messages\/[^/]+\/reply$/, 500)));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the admin is told the reply was not sent', async ({ adminMessages, apiMock }) => {
      knownBug('ADM-10', 'a reply the API refuses (500) leaves the page as it was: no message, and the typed text stays in the box as if nothing happened.', { absence: true });
      const message = await adminMessages.details(contactMessage.name);
      await expect(message.text(contactMessage.message)).toBeVisible();
      const sent = apiMock.waitForRequest('POST', `/messages/${contactMessage.id}/reply`);

      await message.reply('A reply that fails.');
      await sent;

      await expect(message.failure, 'ADM-10: a failed reply tells the admin').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('when the status is not saved', { tag: ['@negative', '@bug'] }, () => {
    test.use(withMocks(mock.fail('PUT', /^\/messages\/[^/]+\/status$/, 500)));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the admin is told the status was not saved', async ({ adminMessages, apiMock }) => {
      knownBug('ADM-11', 'a message status the API refuses to save (500) is not reported: the picker keeps showing the new status as if it had been saved.', { absence: true });
      const message = await adminMessages.details(contactMessage.name);
      await expect(message.text(contactMessage.message)).toBeVisible();
      const sent = apiMock.waitForRequest('PUT', `/messages/${contactMessage.id}/status`);

      await message.setStatus('RESOLVED');
      await sent;

      await expect(message.failure, 'ADM-11: a failed status change tells the admin').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('when the message cannot be loaded', { tag: ['@negative', '@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', /^\/messages\/[^/]+$/, 500)));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the admin is told the message could not be loaded', async ({ adminMessages, apiMock }) => {
      knownBug('ADM-14', ADM_14, { absence: true });
      const failed = apiMock.waitForResponse('GET', /^\/messages\/[^/]+$/);

      const message = await adminMessages.details(contactMessage.name);
      await failed;
      // The page's own controls are drawn whatever the message request answered.
      await expect(message.backLink).toBeVisible();

      // Any alert, or plain error text, will do: the pin does not prescribe the form or the wording.
      await expect(message.failure, 'ADM-14: a failed message load tells the admin').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test('an empty reply is stopped by the form', { tag: ['@negative', '@bug'] }, async ({ adminMessages, apiMock }) => {
    knownBug('ADM-06', 'an empty admin reply is sent to the API ({"message":""}) instead of being validated.', { absence: true });
    const message = await adminMessages.details(contactMessage.name);
    await expect(message.text(contactMessage.message)).toBeVisible();

    await message.replyButton.click();

    await expect(message.feedback.filter({ hasText: /required/i }), 'ADM-06: the form says a reply is required').toBeVisible({ timeout: BUG_TIMEOUT });
    await expect(apiMock.expectNoRequest('POST', `/messages/${contactMessage.id}/reply`), 'ADM-06: no empty reply is sent').resolves.toBeUndefined();
  });
});
