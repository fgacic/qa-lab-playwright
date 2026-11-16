import { expect, mock, test, withMocks } from '@fixtures';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { failureFeedback } from '@support/feedback';
import { CONTACT_SUBJECTS, contactSubjectSlug, emptyProductPage, listOf } from '@support/payloads';
import { CONTACT_MESSAGE, fakeGuest } from '@support/test-data';

/** What the visitor asks for, and what the assistant answers when it finds something. */
const SEARCH_TERM = 'hammer';
const FOUND_REPLY = 'Here are some products I found:';
/** What "Order a product" answers to a search term, instead of FOUND_REPLY. */
const ORDER_RESULTS_REPLY = 'Here are some products I found. Click one to order:';
/** The questions the support-ticket dialogue asks, in order, as far as two tests quote them. */
const EMAIL_PROMPT = 'What is your email address?';
const SUBJECT_PROMPT = 'Please select a subject for your ticket:';
const DESCRIPTION_PROMPT = 'Please describe your issue (minimum 50 characters):';
const ATTACHMENT_PROMPT = 'Would you like to add an attachment?';
/** The subject the ticket dialogue picks: any of the contact form's, named from the same list. */
const TICKET_SUBJECT = CONTACT_SUBJECTS[1].label;

test.describe('Chat assistant', () => {
  test('opens with a greeting and a menu, and closes again', async ({ homePage }) => {
    const { chat } = homePage.shell;

    await chat.open();
    await expect(chat.greeting).toBeVisible();
    for (const action of ['Find a product', 'Order a product', 'Checkout', 'Create support ticket'] as const) {
      await expect(chat.action(action)).toBeVisible();
    }
    await expect(chat.openButton).toBeHidden();

    await chat.close();
    await expect(chat.window).toBeHidden();
    await expect(chat.openButton).toBeVisible();
  });

  // Against the real catalogue, so it runs on our own Toolshop, whose seeded data it knows; the mocked
  // search below proves the same page behaviour with a product of the test's own choosing, everywhere.
  test('finds products by name', { tag: ['@self-hosted'] }, async ({ homePage }) => {
    const { chat } = homePage.shell;
    await chat.open();

    await chat.findProduct(SEARCH_TERM);

    await expect(chat.reply(FOUND_REPLY)).toBeVisible();
    await expect(chat.productResults.first()).toContainText(/hammer/i);
  });

  test('"Order a product" asks what to order', async ({ homePage }) => {
    const { chat } = homePage.shell;
    await chat.open();

    await chat.choose('Order a product');

    await expect(chat.reply('What product would you like to order? Type a product name to search.')).toBeVisible();
  });

  test.describe('"Order a product" with a search term', { tag: ['@mocked'] }, () => {
    test.use({
      apiMocks: async ({ catalog }, use) => {
        const product = await catalog.inStock();
        await use({ routes: [mock.respond('QUERY', '/products/search', { ...listOf([product]), per_page: 9 })] });
      },
    });

    test('lists the matches, then summarises the chosen product and quantity', async ({ homePage, catalog }) => {
      const { chat } = homePage.shell;
      const product = await catalog.inStock();
      await chat.open();
      await chat.choose('Order a product');
      await chat.send(product.name);
      await expect(chat.reply(ORDER_RESULTS_REPLY)).toBeVisible();

      await chat.productResult(product.name).click();
      await expect(chat.reply('Great choice! You selected:')).toBeVisible();
      await expect(chat.reply('How many would you like to order?')).toBeVisible();
      await chat.pick('2');

      await expect(chat.reply('Order Summary:')).toBeVisible();
      await expect(chat.reply(`$${(product.price * 2).toFixed(2)}`)).toBeVisible();
      await expect(chat.reply('Would you like to add this to your cart?')).toBeVisible();
    });
  });

  test('"Checkout" with an empty cart asks for products first', { tag: ['@negative'] }, async ({ homePage }) => {
    const { chat } = homePage.shell;
    await chat.open();

    await chat.choose('Checkout');

    await expect(chat.reply('Your cart is empty. Please add some products first.')).toBeVisible();
  });

  test('"Back to menu" returns to the choices', async ({ homePage }) => {
    const { chat } = homePage.shell;
    await chat.open();
    await chat.choose('Order a product');

    await chat.backToMenu();

    // The assistant answers with the greeting and the menu again, below the first ones.
    await expect(chat.greeting).toHaveCount(2);
    await expect(chat.action('Find a product')).toBeVisible();
  });

  test('Enter in the message box sends it as the button does', async ({ homePage, apiMock }) => {
    const { chat } = homePage.shell;
    await chat.open();
    await chat.choose('Find a product');
    const searched = apiMock.waitForRequest('QUERY', '/products/search');

    await chat.sendWithEnter(SEARCH_TERM);

    expect((await searched).postDataJSON()).toMatchObject({ q: SEARCH_TERM });
    await expect(chat.line(SEARCH_TERM)).toBeVisible();
  });

  test('Escape closes the chat', { tag: ['@a11y', '@bug'] }, async ({ homePage }) => {
    knownBug('BUG-45', 'the chat window does not close on Escape, as a dialog is expected to: only its close button does.', { absence: true });
    const { chat } = homePage.shell;
    await chat.open();
    // With the message box in use, where a visitor's hands are: it only exists once an action has been picked.
    await chat.choose('Find a product');
    await expect(chat.input).toBeVisible();

    await chat.closeWithEscape();

    await expect(chat.window, 'BUG-45: Escape closes the chat').toBeHidden({ timeout: BUG_TIMEOUT });
  });

  test.describe('a support ticket', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('POST', '/messages', { id: '01QALABFAKEMESSAGE0000000', status: 'NEW' })));

    test('is collected question by question and sent as a message', async ({ homePage, apiMock }) => {
      const { chat } = homePage.shell;
      const guest = fakeGuest();
      await chat.open();
      await chat.choose('Create support ticket');
      await expect(chat.reply("I'll help you create a support ticket. What is your first name?")).toBeVisible();

      await chat.send(guest.firstName);
      await expect(chat.reply('What is your last name?')).toBeVisible();
      await chat.send(guest.lastName);
      await expect(chat.reply(EMAIL_PROMPT)).toBeVisible();
      await chat.send(guest.email);
      await expect(chat.reply(SUBJECT_PROMPT)).toBeVisible();
      await chat.pick(TICKET_SUBJECT);
      await expect(chat.reply(DESCRIPTION_PROMPT)).toBeVisible();
      await chat.send(CONTACT_MESSAGE);
      await expect(chat.reply(ATTACHMENT_PROMPT)).toBeVisible();
      const sent = apiMock.waitForRequest('POST', '/messages');
      await chat.pick('Skip');

      await expect(chat.reply("Your support ticket has been submitted successfully! We'll get back to you soon.")).toBeVisible();
      expect((await sent).postDataJSON()).toMatchObject({
        name: `${guest.firstName} ${guest.lastName}`,
        email: guest.email,
        subject: contactSubjectSlug(TICKET_SUBJECT),
        message: CONTACT_MESSAGE,
      });
    });
  });

  test.describe('a support ticket the API refuses', { tag: ['@mocked', '@negative'] }, () => {
    test.use(withMocks(mock.fail('POST', '/messages', 500)));

    test('the assistant says the ticket was not submitted, with the reason', async ({ homePage, apiMock }) => {
      const { chat } = homePage.shell;
      await chat.open();
      await chat.fillTicketUntilAttachment(fakeGuest(), TICKET_SUBJECT, CONTACT_MESSAGE);
      await expect(chat.reply(ATTACHMENT_PROMPT)).toBeVisible();
      const answered = apiMock.waitForResponse('POST', '/messages');
      await chat.pick('Skip');

      expect((await answered).response.status()).toBe(500);
      await expect(chat.reply('There was an error submitting your ticket:')).toBeVisible();
      await expect(chat.reply('Server Error')).toBeVisible();
      await expect(chat.reply("Your support ticket has been submitted successfully! We'll get back to you soon.")).toBeHidden();
    });
  });

  test.describe('a support ticket whose request never arrives', { tag: ['@mocked', '@negative', '@bug'] }, () => {
    test.use(withMocks(mock.abort('POST', '/messages')));

    test('the assistant gives a reason a visitor can read, not the word "true"', async ({ homePage, apiMock }) => {
      knownBug('BUG-55', 'a ticket whose request is aborted (no answer at all) is followed by the literal text "true" after "There was an error submitting your ticket:".');
      const { chat } = homePage.shell;
      await chat.open();
      await chat.fillTicketUntilAttachment(fakeGuest(), TICKET_SUBJECT, CONTACT_MESSAGE);
      await expect(chat.reply(ATTACHMENT_PROMPT)).toBeVisible();
      const sent = apiMock.waitForRequest('POST', '/messages');
      await chat.pick('Skip');
      await sent;
      // Precondition, true whether or not the bug is fixed: the ticket is reported as failed, and not as submitted.
      await expect(chat.reply('There was an error submitting your ticket:')).toBeVisible();
      await expect(chat.reply("Your support ticket has been submitted successfully! We'll get back to you soon.")).toBeHidden();

      await expect(chat.reply(/^\s*true\s*$/), 'BUG-55: the reason after the error is not the literal "true"').toBeHidden({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('when the search finds a product', { tag: ['@mocked'] }, () => {
    test.use({
      apiMocks: async ({ catalog }, use) => {
        const product = await catalog.inStock();
        await use({ routes: [mock.respond('QUERY', '/products/search', { ...listOf([product]), per_page: 9 })] });
      },
    });

    test('its card shows the name and the price', async ({ homePage, catalog }) => {
      const { chat } = homePage.shell;
      const product = await catalog.inStock();
      await chat.open();

      await chat.findProduct(product.name);

      await expect(chat.reply(FOUND_REPLY)).toBeVisible();
      await expect(chat.productResults).toHaveCount(1);
      await expect(chat.productResult(product.name)).toContainText(`$${product.price.toFixed(2)}`);
    });
  });

  test.describe('the ticket form validates what the visitor types', { tag: ['@negative'] }, () => {
    // Nothing answers POST /messages here: the guard refuses a ticket that should never be sent.
    test.beforeEach(async ({ homePage, apiMock }) => {
      await apiMock.blockUnmockedWrites();
      await homePage.shell.chat.open();
      await homePage.shell.chat.choose('Create support ticket');
    });

    test('a malformed email is asked for again', async ({ homePage, apiMock }) => {
      const { chat } = homePage.shell;
      await chat.send('Testy');
      await chat.send('McTestface');
      await expect(chat.reply(EMAIL_PROMPT)).toBeVisible();

      await chat.send('not-an-email');

      await expect(chat.reply('Please enter a valid email address.')).toBeVisible();
      await apiMock.expectNoRequest('POST', '/messages');
      // After the window above, so "hidden" means the next question was not asked, not that it has not arrived yet.
      await expect(chat.reply(SUBJECT_PROMPT)).toBeHidden();
      // Still waiting for the email: the same question's answer, corrected, is what moves the dialogue on.
      await chat.send(fakeGuest().email);
      await expect(chat.line(SUBJECT_PROMPT)).toHaveCount(1);
    });

    test('a description under 50 characters is asked for again', async ({ homePage, apiMock }) => {
      const { chat } = homePage.shell;
      const guest = fakeGuest();
      await chat.send(guest.firstName);
      await chat.send(guest.lastName);
      await chat.send(guest.email);
      await chat.pick(TICKET_SUBJECT);
      await expect(chat.reply(DESCRIPTION_PROMPT)).toBeVisible();

      await chat.send('too short');

      await expect(chat.reply('Your message must be at least 50 characters long.')).toBeVisible();
      await apiMock.expectNoRequest('POST', '/messages');
      // After the window above, so "hidden" means the next question was not asked, not that it has not arrived yet.
      await expect(chat.reply(ATTACHMENT_PROMPT)).toBeHidden();
      // Still waiting for the description: a long enough one is what moves the dialogue on.
      await chat.send(CONTACT_MESSAGE);
      await expect(chat.line(ATTACHMENT_PROMPT)).toHaveCount(1);
    });
  });

  test.describe('when the search finds nothing', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('QUERY', '/products/search', emptyProductPage())));

    test('the assistant says so', async ({ homePage }) => {
      const { chat } = homePage.shell;
      await chat.open();

      await chat.findProduct(SEARCH_TERM);

      await expect(chat.reply('No products found. Try a different search.')).toBeVisible();
    });
  });

  test.describe('when the search fails', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('QUERY', '/products/search', 500)));

    test('the assistant says it could not search', async ({ homePage, apiMock, page }) => {
      knownBug('BUG-25', 'a failed chat search answers "No products found", as if nothing matched.', { absence: true });
      const { chat } = homePage.shell;
      await chat.open();

      const searched = apiMock.waitForResponse('QUERY', '/products/search');
      await chat.findProduct(SEARCH_TERM);

      // Evidence that the failure path ran, whatever the chat then says: the search was refused and the question stayed in the transcript.
      expect((await searched).response.status()).toBe(500);
      await expect(chat.line(SEARCH_TERM)).toBeVisible();

      // In the transcript, or in an alert: either tells the visitor the search failed.
      await expect(chat.reply(/could not|went wrong|error|try again later/i).or(failureFeedback(page)).first(), 'BUG-25: the assistant says the search failed').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });
});
