import { expect, mock, test, withMocks } from '@fixtures';
import { holdAnswers } from '@support/answer-gate';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { failureFeedback } from '@support/feedback';
import type { ContactMessage, ContactPage } from '@pages/ContactPage';
import type { ApiMock } from '@support/api-mock';
import { CONTACT_SUBJECTS, acceptedMessage, contactSubjectSlug, fakeUser } from '@support/payloads';
import { CONTACT_MESSAGE, fakeGuest } from '@support/test-data';

/** The subject a test uses when it does not care which one, and a second one for the test that does. */
const [DEFAULT_SUBJECT, OTHER_SUBJECT] = [CONTACT_SUBJECTS[1].label, CONTACT_SUBJECTS[0].label];

const message = (overrides: Partial<ContactMessage> = {}): ContactMessage => ({
  from: fakeGuest(),
  subject: DEFAULT_SUBJECT,
  message: CONTACT_MESSAGE,
  ...overrides,
});
/** A message of exactly `length` characters, for the boundary around the form's 50-character minimum. */
const messageOfLength = (length: number) => 'a'.repeat(length);
const MIN_MESSAGE_LENGTH = 50;
const MIN_LENGTH_ERROR = `Message must be minimal ${MIN_MESSAGE_LENGTH} characters`;
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

      await expect(contactPage.message.error).toHaveText(MIN_LENGTH_ERROR);
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
    const contact = message({ subject: OTHER_SUBJECT, attachment: textFile('empty.txt', '') });
    const sent = apiMock.waitForRequest('POST', '/messages');

    await contactPage.send(contact);

    expect((await sent).postDataJSON()).toMatchObject(sentBody(contact));
    await expect(contactPage.successMessage).toBeVisible();
    // The form is replaced by the thanks, so nothing typed stays on the page for a second message.
    await expect(contactPage.sendButton).toBeHidden();
    await expect(contactPage.message.input).toBeHidden();
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

  test.describe('when the API is slow to accept the message', { tag: ['@mocked', '@bug'] }, () => {
    test('a double-click on Send sends one message', async ({ contactPage, page }) => {
      knownBug('BUG-59', 'Send stays enabled while its request is open: a double-click posts the same message twice.');
      // Held until both clicks have landed (the pattern of BUG-46 and BUG-53): the second click then meets the same open request on every engine, at any speed.
      const sent = await holdAnswers(page, /\/messages$/, acceptedMessage);
      await contactPage.fillIn(message());

      await contactPage.submitTwice();
      sent.release();
      // Precondition, true whether or not the bug is fixed: the first message was acknowledged.
      await expect(contactPage.successMessage).toBeVisible();

      expect(sent.reached, 'BUG-59: one message, one request').toBe(1);
    });
  });

  test.describe('when the API accepts a message of only spaces', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.respond('POST', '/messages', acceptedMessage, 201)));

    test('a message of only spaces is rejected', { tag: ['@negative'] }, async ({ contactPage, apiMock }) => {
      knownBug('BUG-58', 'a message of 60 spaces passes the 50-character minimum and is sent: the form does not trim it.', { absence: true });
      const before = await apiMock.mark();

      await contactPage.send(message({ message: ' '.repeat(MIN_MESSAGE_LENGTH + 10) }));

      await expect(apiMock.expectNoRequest('POST', '/messages', { since: before }), 'BUG-58: a message of spaces is not sent').resolves.toBeUndefined();
      await expect(contactPage.message.error, 'BUG-58: the form says the message is missing').toBeVisible({ timeout: BUG_TIMEOUT });
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

  // The mocked session (a fake token, a mocked GET /users/me) is enough: what the form shows and sends depends on the token it holds.
  // The page is opened by the test, once the session is in place (the `contactPage` fixture would open it first).
  test.describe('for a signed-in customer', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('POST', '/messages', acceptedMessage, 201)));

    test('the form greets the customer by name and asks for no name or email', async ({ signedIn: _, shop }) => {
      await shop.contact.open();

      await expect(shop.contact.greeting).toHaveText(`Hello ${fakeUser.first_name} ${fakeUser.last_name}, please fill out this form to submit your message.`);
      await expect(shop.contact.firstName.input).toHaveCount(0);
      await expect(shop.contact.lastName.input).toHaveCount(0);
      await expect(shop.contact.email.input).toHaveCount(0);
      await expect(shop.contact.subject.input).toBeVisible();
    });

    test('the message is sent under the customer\'s name, with the customer\'s token', async ({ signedIn: _, shop, apiMock }) => {
      await shop.contact.open();
      const sent = apiMock.waitForRequest('POST', '/messages');

      await shop.contact.sendAsCustomer(DEFAULT_SUBJECT, CONTACT_MESSAGE);

      const request = await sent;
      expect(request.postDataJSON()).toEqual({ name: `${fakeUser.first_name} ${fakeUser.last_name}`, subject: contactSubjectSlug(DEFAULT_SUBJECT), message: CONTACT_MESSAGE });
      expect((await request.allHeaders()).authorization, 'the request carries the signed-in token').toMatch(/^Bearer \S+/);
      await expect(shop.contact.successMessage).toBeVisible();
    });

    test('a message that is too short is stopped by the form', { tag: ['@negative'] }, async ({ signedIn: _, shop, apiMock }) => {
      await shop.contact.open();
      const before = await apiMock.mark();

      await shop.contact.sendAsCustomer(DEFAULT_SUBJECT, messageOfLength(MIN_MESSAGE_LENGTH - 1));

      await expect(shop.contact.message.error).toHaveText(MIN_LENGTH_ERROR);
      await apiMock.expectNoRequest('POST', '/messages', { since: before });
    });
  });
});
