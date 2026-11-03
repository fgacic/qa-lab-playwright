import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { CONTACT_SUBJECTS, type ContactMessage } from '@pages/ContactPage';
import { CONTACT_MESSAGE, fakeGuest } from '@support/test-data';

const message = (overrides: Partial<ContactMessage> = {}): ContactMessage => ({
  from: fakeGuest(),
  subject: 'Webmaster',
  message: CONTACT_MESSAGE,
  ...overrides,
});
const textFile = (name: string, content: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(content) });

test.describe('Contact form', () => {
  // The "Select a subject *" placeholder is disabled and hidden, so it is not an option to pick.
  test('offers the six subjects', async ({ contactPage }) => {
    await expect(contactPage.subject.input.getByRole('option')).toHaveText([...CONTACT_SUBJECTS]);
  });

  test('an empty form flags every required field', { tag: ['@negative'] }, async ({ contactPage }) => {
    await contactPage.submit();

    await expect(contactPage.firstName.error).toHaveText('First name is required');
    await expect(contactPage.lastName.error).toHaveText('Last name is required');
    await expect(contactPage.email.error).toHaveText('Email is required');
    await expect(contactPage.subject.error).toHaveText('Subject is required');
    await expect(contactPage.message.error).toHaveText('Message is required');
  });

  test('a malformed email is rejected', { tag: ['@negative'] }, async ({ contactPage }) => {
    await contactPage.send(message({ from: { ...fakeGuest(), email: 'not-an-email' } }));

    await expect(contactPage.email.error).toHaveText('Email format is invalid');
  });

  test('a message under 50 characters is rejected', { tag: ['@negative'] }, async ({ contactPage }) => {
    await contactPage.send(message({ message: 'Too short to be a useful message.' }));

    await expect(contactPage.message.error).toHaveText('Message must be minimal 50 characters');
  });

  test('an attachment with content is rejected: files must be empty', { tag: ['@negative'] }, async ({ contactPage }) => {
    await contactPage.send(message({ attachment: textFile('notes.txt', 'not empty') }));

    await expect(contactPage.attachment.error).toHaveText('File should be empty.');
  });

  test('an attachment that is not .txt is rejected', { tag: ['@negative'] }, async ({ contactPage }) => {
    await contactPage.send(message({ attachment: { name: 'image.png', mimeType: 'image/png', buffer: Buffer.alloc(0) } }));

    await expect(contactPage.attachment.error).toHaveText('File should have a txt extension.');
  });

  test('a complete message is sent and acknowledged', { tag: ['@smoke', '@flow'] }, async ({ contactPage, apiMock }) => {
    const contact = message({ subject: 'Customer service', attachment: textFile('empty.txt', '') });
    const sent = apiMock.waitForRequest('POST', '/messages');

    await contactPage.send(contact);

    expect((await sent).postDataJSON()).toMatchObject({
      name: `${contact.from.firstName} ${contact.from.lastName}`,
      email: contact.from.email,
      subject: 'customer-service',
      message: contact.message,
    });
    await expect(contactPage.successMessage).toBeVisible();
    await expect(contactPage.sendButton).toBeHidden();
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

    test('the validation message is readable', async ({ contactPage }) => {
      knownBug('BUG-21', 'a 422 from POST /messages is shown as "The given data was invalid. [object Object]".');
      await contactPage.send(message());
      await expect(contactPage.statusMessage(/The given data was invalid/)).toBeVisible();

      await expect(contactPage.statusMessage(/\[object Object\]/)).toBeHidden({ timeout: 2_000 });
    });
  });

  test.describe('when the API cannot be reached', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.abort('POST', '/messages')));

    test('the shopper is told the message was not sent', async ({ contactPage }) => {
      knownBug('BUG-22', 'a network failure on POST /messages shows the literal text "true" as the error.');
      await contactPage.send(message());
      await expect(contactPage.sendButton).toBeVisible();

      await expect(contactPage.shell.errorAlert).toBeVisible({ timeout: 5_000 });
    });
  });
});
