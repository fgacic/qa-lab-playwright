import { expect, mock, test, withMocks } from '@fixtures';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { failureFeedback } from '@support/feedback';
import { CONTACT_SUBJECTS, contactSubjectSlug, emptyProductPage, listOf, serverError } from '@support/payloads';
import { CONTACT_MESSAGE, fakeGuest } from '@support/test-data';

/** What the visitor asks for. */
const SEARCH_TERM = 'hammer';
/** The quantity the order dialogue is answered with. */
const QUANTITY = 2;
/**
 * What the assistant says, word for word, in the order of its dialogues: one script for the whole file (the wording is the
 * shop's, so a changed sentence is one edit here and not one per test). Each line is read as "the newest reply with this text".
 */
const ASSISTANT = {
  found: 'Here are some products I found:',
  nothingFound: 'No products found. Try a different search.',
  // "Order a product": answers a search term with its own list, then walks through product, quantity and summary.
  orderWhat: 'What product would you like to order? Type a product name to search.',
  orderResults: 'Here are some products I found. Click one to order:',
  orderChosen: 'Great choice! You selected:',
  orderQuantity: 'How many would you like to order?',
  orderSummary: 'Order Summary:',
  orderConfirm: 'Would you like to add this to your cart?',
  orderAdded: 'Added to your cart!',
  cartTotal: 'Your cart total:',
  emptyCart: 'Your cart is empty. Please add some products first.',
  // The support-ticket dialogue, in order.
  ticketStart: "I'll help you create a support ticket. What is your first name?",
  lastName: 'What is your last name?',
  email: 'What is your email address?',
  emailAgain: 'Please enter a valid email address.',
  subject: 'Please select a subject for your ticket:',
  description: 'Please describe your issue (minimum 50 characters):',
  descriptionAgain: 'Your message must be at least 50 characters long.',
  attachment: 'Would you like to add an attachment?',
  // How the dialogue ends: the ticket was sent, or it was not (the reason follows the second).
  submitted: "Your support ticket has been submitted successfully! We'll get back to you soon.",
  error: 'There was an error submitting your ticket:',
} as const;
/** The answer to the attachment question that sends the ticket without one, and the two answers of the order dialogue's last question. */
const SKIP_ATTACHMENT = 'Skip';
const ADD_TO_CART = 'Yes, add to cart';
/** The subject the ticket dialogue picks: any of the contact form's, named from the same list. */
const TICKET_SUBJECT = CONTACT_SUBJECTS[1].label;

test.describe('Chat assistant', () => {
  test('opens with a greeting and a menu, and closes again', async ({ homePage }) => {
    const { chat } = homePage.shell;

    await chat.open();
    await expect(chat.greeting).toBeVisible();
    for (const action of ['Find a product', 'Order a product', 'Checkout', 'Create support ticket'] as const) {
      await expect.soft(chat.action(action), action).toBeVisible();
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

    await expect(chat.reply(ASSISTANT.found)).toBeVisible();
    await expect(chat.productResults.first()).toContainText(/hammer/i);
  });

  test('"Order a product" asks what to order', async ({ homePage }) => {
    const { chat } = homePage.shell;
    await chat.open();

    await chat.choose('Order a product');

    await expect(chat.reply(ASSISTANT.orderWhat)).toBeVisible();
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
      await expect(chat.reply(ASSISTANT.orderResults)).toBeVisible();

      await chat.productResult(product.name).click();
      await expect(chat.reply(ASSISTANT.orderChosen)).toBeVisible();
      await expect(chat.reply(ASSISTANT.orderQuantity)).toBeVisible();
      await chat.pick(String(QUANTITY));

      await expect(chat.reply(ASSISTANT.orderSummary)).toBeVisible();
      await expect(chat.reply(`$${(product.price * QUANTITY).toFixed(2)}`)).toBeVisible();
      await expect(chat.reply(ASSISTANT.orderConfirm)).toBeVisible();
    });

    // The rest of the dialogue, which the test above stops short of: the answer to its last question puts the order in the cart
    // (an anonymous cart, the one write the guard lets through on every target) and the menu's Checkout then has something to check out.
    test('adds the order to the cart, and "Checkout" then shows the cart total', async ({ homePage, catalog }) => {
      const { chat, header } = homePage.shell;
      const product = await catalog.inStock();
      await chat.open();
      await chat.choose('Order a product');
      await chat.send(product.name);
      await chat.productResult(product.name).click();
      await chat.pick(String(QUANTITY));
      await expect(chat.reply(ASSISTANT.orderConfirm)).toBeVisible();

      await chat.pick(ADD_TO_CART);

      await expect(chat.reply(ASSISTANT.orderAdded)).toBeVisible();
      await expect(header.cartLink).toHaveText(String(QUANTITY));
      await chat.choose('Checkout');
      await expect(chat.reply(ASSISTANT.cartTotal)).toBeVisible();
      await expect(chat.reply(`$${(product.price * QUANTITY).toFixed(2)}`)).toBeVisible();
      await expect(chat.reply(ASSISTANT.emptyCart)).toHaveCount(0);
    });
  });

  test('"Checkout" with an empty cart asks for products first', { tag: ['@negative'] }, async ({ homePage }) => {
    const { chat } = homePage.shell;
    await chat.open();

    await chat.choose('Checkout');

    await expect(chat.reply(ASSISTANT.emptyCart)).toBeVisible();
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

  test.describe('Enter in the message box', { tag: ['@mocked'] }, () => {
    test.use({
      apiMocks: async ({ catalog }, use) => {
        const product = await catalog.inStock();
        await use({ routes: [mock.respond('QUERY', '/products/search', { ...listOf([product]), per_page: 9 })] });
      },
    });

    test('sends the message as the button does and the assistant answers', async ({ homePage, apiMock }) => {
      const { chat } = homePage.shell;
      await chat.open();
      await chat.choose('Find a product');
      const searched = apiMock.waitForRequest('QUERY', '/products/search');

      await chat.sendWithEnter(SEARCH_TERM);

      expect((await searched).postDataJSON()).toMatchObject({ q: SEARCH_TERM });
      await expect(chat.line(SEARCH_TERM)).toBeVisible();
      await expect(chat.reply(ASSISTANT.found)).toBeVisible();
    });
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
      await expect(chat.reply(ASSISTANT.ticketStart)).toBeVisible();

      await chat.send(guest.firstName);
      await expect(chat.reply(ASSISTANT.lastName)).toBeVisible();
      await chat.send(guest.lastName);
      await expect(chat.reply(ASSISTANT.email)).toBeVisible();
      await chat.send(guest.email);
      await expect(chat.reply(ASSISTANT.subject)).toBeVisible();
      await chat.pick(TICKET_SUBJECT);
      await expect(chat.reply(ASSISTANT.description)).toBeVisible();
      await chat.send(CONTACT_MESSAGE);
      await expect(chat.reply(ASSISTANT.attachment)).toBeVisible();
      const sent = apiMock.waitForRequest('POST', '/messages');
      await chat.pick(SKIP_ATTACHMENT);

      await expect(chat.reply(ASSISTANT.submitted)).toBeVisible();
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
      await expect(chat.reply(ASSISTANT.attachment)).toBeVisible();
      const answered = apiMock.waitForResponse('POST', '/messages');
      await chat.pick(SKIP_ATTACHMENT);

      expect((await answered).response.status()).toBe(500);
      await expect(chat.reply(ASSISTANT.error)).toBeVisible();
      await expect(chat.reply(serverError.message)).toBeVisible();
      await expect(chat.reply(ASSISTANT.submitted)).toHaveCount(0);
    });
  });

  test.describe('a support ticket whose request never arrives', { tag: ['@mocked', '@negative', '@bug'] }, () => {
    test.use(withMocks(mock.abort('POST', '/messages')));

    test('the assistant gives a reason a visitor can read, not the word "true"', async ({ homePage, apiMock }) => {
      knownBug('BUG-55', 'a ticket whose request is aborted (no answer at all) is followed by the literal text "true" after "There was an error submitting your ticket:".');
      const { chat } = homePage.shell;
      await chat.open();
      await chat.fillTicketUntilAttachment(fakeGuest(), TICKET_SUBJECT, CONTACT_MESSAGE);
      await expect(chat.reply(ASSISTANT.attachment)).toBeVisible();
      const sent = apiMock.waitForRequest('POST', '/messages');
      await chat.pick(SKIP_ATTACHMENT);
      await sent;
      // Precondition, true whether or not the bug is fixed: the ticket is reported as failed, and not as submitted.
      await expect(chat.reply(ASSISTANT.error)).toBeVisible();
      await expect(chat.reply(ASSISTANT.submitted)).toHaveCount(0);

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

      await expect(chat.reply(ASSISTANT.found)).toBeVisible();
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
      const guest = fakeGuest();
      await chat.send(guest.firstName);
      await chat.send(guest.lastName);
      await expect(chat.reply(ASSISTANT.email)).toBeVisible();

      await chat.send('not-an-email');

      await expect(chat.reply(ASSISTANT.emailAgain)).toBeVisible();
      await apiMock.expectNoRequest('POST', '/messages');
      // After the window above, so "hidden" means the next question was not asked, not that it has not arrived yet.
      await expect(chat.reply(ASSISTANT.subject)).toBeHidden();
      // Still waiting for the email: the same question's answer, corrected, is what moves the dialogue on.
      await chat.send(guest.email);
      await expect(chat.line(ASSISTANT.subject)).toHaveCount(1);
    });

    test('a description under 50 characters is asked for again', async ({ homePage, apiMock }) => {
      const { chat } = homePage.shell;
      const guest = fakeGuest();
      await chat.send(guest.firstName);
      await chat.send(guest.lastName);
      await chat.send(guest.email);
      await chat.pick(TICKET_SUBJECT);
      await expect(chat.reply(ASSISTANT.description)).toBeVisible();

      await chat.send('too short');

      await expect(chat.reply(ASSISTANT.descriptionAgain)).toBeVisible();
      await apiMock.expectNoRequest('POST', '/messages');
      // After the window above, so "hidden" means the next question was not asked, not that it has not arrived yet.
      await expect(chat.reply(ASSISTANT.attachment)).toBeHidden();
      // Still waiting for the description: a long enough one is what moves the dialogue on.
      await chat.send(CONTACT_MESSAGE);
      await expect(chat.line(ASSISTANT.attachment)).toHaveCount(1);
    });
  });

  test.describe('when the search finds nothing', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('QUERY', '/products/search', emptyProductPage())));

    test('the assistant says so', async ({ homePage }) => {
      const { chat } = homePage.shell;
      await chat.open();

      await chat.findProduct(SEARCH_TERM);

      await expect(chat.reply(ASSISTANT.nothingFound)).toBeVisible();
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
