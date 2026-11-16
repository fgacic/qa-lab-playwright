import { expect, mock, test, withMocks } from '@fixtures';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { failureFeedback } from '@support/feedback';
import type { ContactMessage, ContactPage } from '@pages/ContactPage';
import type { ApiMock } from '@support/api-mock';
import { CONTACT_SUBJECTS, acceptedMessage, contactSubjectSlug } from '@support/payloads';
import { CONTACT_MESSAGE, fakeGuest } from '@support/test-data';

const message = (overrides: Partial<ContactMessage> = {}): ContactMessage => ({
  from: fakeGuest(),
  subject: 'Webmaster',
  message: CONTACT_MESSAGE,
  ...overrides,
});
/** A message of exactly `length` characters, for the boundary around the form's 50-character minimum. */
const messageOfLength = (length: number) => 'a'.repeat(length);
const MIN_MESSAGE_LENGTH = 50;
const textFile = (name: string, content: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(content) });

test.describe('Contact form', () => {
  // The "Select a subject *" placeholder is disabled and hidden, so it is not an option to pick.
  test('offers the six subjects', async ({ contactPage }) => {
    await expect(contactPage.subject.input.getByRole('option')).toHaveText(CONTACT_SUBJECTS.map((subject) => subject.label));
  });

  // The form's own validation must stop these. If it regresses, the guard refuses the write (so the real
  // inbox stays clean) and `expectNoRequest`, which watches a short window after the labels appear, names it.
  test.describe('validation', () => {
    test.beforeEach(async ({ apiMock }) => {
      await apiMock.blockUnmockedWrites();
    });

    test('an empty form flags every required field', { tag: ['@negative'] }, async ({ contactPage, apiMock }) => {
      await contactPage.submit();

      await expect(contactPage.firstName.error).toHaveText('First name is required');
      await expect(contactPage.lastName.error).toHaveText('Last name is required');
      await expect(contactPage.email.error).toHaveText('Email is required');
      await expect(contactPage.subject.error).toHaveText('Subject is required');
      await expect(contactPage.message.error).toHaveText('Message is required');
      await apiMock.expectNoRequest('POST', '/messages');
    });

    test('a malformed email is rejected', { tag: ['@negative'] }, async ({ contactPage, apiMock }) => {
      await contactPage.send(message({ from: { ...fakeGuest(), email: 'not-an-email' } }));

      await expect(contactPage.email.error).toHaveText('Email format is invalid');
      await apiMock.expectNoRequest('POST', '/messages');
    });

    test(`a message of ${MIN_MESSAGE_LENGTH - 1} characters is rejected`, { tag: ['@negative'] }, async ({ contactPage, apiMock }) => {
      await contactPage.send(message({ message: messageOfLength(MIN_MESSAGE_LENGTH - 1) }));

      await expect(contactPage.message.error).toHaveText('Message must be minimal 50 characters');
      await apiMock.expectNoRequest('POST', '/messages');
    });

    test('an attachment with content is rejected: files must be empty', { tag: ['@negative'] }, async ({ contactPage, apiMock }) => {
      await contactPage.send(message({ attachment: textFile('notes.txt', 'not empty') }));

      await expect(contactPage.attachment.error).toHaveText('File should be empty.');
      await apiMock.expectNoRequest('POST', '/messages');
    });

    test('an attachment that is not .txt is rejected', { tag: ['@negative'] }, async ({ contactPage, apiMock }) => {
      await contactPage.send(message({ attachment: { name: 'image.png', mimeType: 'image/png', buffer: Buffer.alloc(0) } }));

      await expect(contactPage.attachment.error).toHaveText('File should have a txt extension.');
      await apiMock.expectNoRequest('POST', '/messages');
    });
  });

  const sentBody = (contact: ContactMessage) => ({
    name: `${contact.from.firstName} ${contact.from.lastName}`,
    email: contact.from.email,
    subject: contactSubjectSlug(contact.subject),
    message: contact.message,
  });

  // The same journey twice: the real write lands in the shop's inbox, so that run is on our own Toolshop only;
  // the mocked twin answers the write itself, so it also runs on the public site.
  const sendsAndAcknowledges = async ({ contactPage, apiMock }: { contactPage: ContactPage; apiMock: ApiMock }) => {
    const contact = message({ subject: 'Customer service', attachment: textFile('empty.txt', '') });
    const sent = apiMock.waitForRequest('POST', '/messages');

    await contactPage.send(contact);

    expect((await sent).postDataJSON()).toMatchObject(sentBody(contact));
    await expect(contactPage.successMessage).toBeVisible();
    await expect(contactPage.sendButton).toBeHidden();
  };

  test('a complete message is sent and acknowledged (real)', { tag: ['@smoke', '@flow', '@self-hosted'] }, sendsAndAcknowledges);

  test.describe('when the API accepts the message', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('POST', '/messages', acceptedMessage, 201)));

    test('a complete message is sent and acknowledged (mocked)', { tag: ['@smoke', '@flow'] }, sendsAndAcknowledges);

    test(`a message of exactly ${MIN_MESSAGE_LENGTH} characters is accepted`, async ({ contactPage, apiMock }) => {
      const contact = message({ message: messageOfLength(MIN_MESSAGE_LENGTH) });
      const sent = apiMock.waitForRequest('POST', '/messages');

      await contactPage.send(contact);

      expect((await sent).postDataJSON()).toMatchObject({ message: contact.message });
      await expect(contactPage.successMessage).toBeVisible();
    });

    test('Enter in the email field sends the message as the button does', async ({ contactPage, apiMock }) => {
      const contact = message();
      const sent = apiMock.waitForRequest('POST', '/messages');

      await contactPage.sendWithEnter(contact);

      expect((await sent).postDataJSON()).toMatchObject(sentBody(contact));
      await expect(contactPage.successMessage).toBeVisible();
    });
  });

  test.describe('when sending fails', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('POST', '/messages', 500)));

    test('the error is shown and the form stays', async ({ contactPage }) => {
      await contactPage.send(message());

      await expect(contactPage.statusMessage('Server Error')).toBeVisible();
      await expect(contactPage.sendButton).toBeVisible();
    });
  });

  test.describe('when the API rejects the message', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('POST', '/messages', 422, { message: 'The given data was invalid.', errors: { email: ['The email field must be a valid email address.'] } })));

    test('the validation message is readable', async ({ contactPage, apiMock }) => {
      knownBug('BUG-21', 'a 422 from POST /messages is shown as "The given data was invalid. [object Object]".', { absence: true });
      const answered = apiMock.waitForResponse('POST', '/messages');
      await contactPage.send(message());
      expect((await answered).response.status()).toBe(422);

      await expect(contactPage.statusMessage(/valid email address/), 'BUG-21: the validation detail is readable').toBeVisible({ timeout: BUG_TIMEOUT });
      await expect(contactPage.statusMessage('[object Object]'), 'BUG-21: no unrendered object in the message').toHaveCount(0);
    });
  });

  test.describe('when the API cannot be reached', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.abort('POST', '/messages')));

    test('the shopper is told the message was not sent', async ({ contactPage, apiMock, page }) => {
      knownBug('BUG-22', 'a network failure on POST /messages shows the literal text "true" as the error.', { absence: true });
      const attempted = apiMock.waitForRequest('POST', '/messages');
      await contactPage.send(message());
      await attempted;

      // Any wording that says the message was not sent will do, in the form's status line or in an alert (the two ways the shop
      // reports a failure); a bare "error" or "failed" would also match unrelated text.
      const notSent = contactPage.statusMessage(/(?:not|could ?n.?t|unable to|failed to) (?:be )?sen[dt]|went wrong|try again/i).or(failureFeedback(page));
      await expect(notSent.first(), 'BUG-22: the shopper is told the message was not sent').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });
});
