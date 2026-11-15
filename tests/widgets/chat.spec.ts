import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { contactSubjectSlug, emptyProductPage, page as paged } from '@support/payloads';
import { CONTACT_MESSAGE, fakeGuest } from '@support/test-data';

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

  test('finds products by name', async ({ homePage }) => {
    const { chat } = homePage.shell;
    await chat.open();

    await chat.findProduct('hammer');

    await expect(chat.reply('Here are some products I found:')).toBeVisible();
    await expect(chat.productResults.first()).toContainText(/hammer/i);
  });

  test('"Order a product" asks what to order', async ({ homePage }) => {
    const { chat } = homePage.shell;
    await chat.open();

    await chat.choose('Order a product');

    await expect(chat.reply('What product would you like to order? Type a product name to search.')).toBeVisible();
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
      await expect(chat.reply('What is your email address?')).toBeVisible();
      await chat.send(guest.email);
      await expect(chat.reply('Please select a subject for your ticket:')).toBeVisible();
      await chat.pick('Webmaster');
      await expect(chat.reply('Please describe your issue (minimum 50 characters):')).toBeVisible();
      await chat.send(CONTACT_MESSAGE);
      await expect(chat.reply('Would you like to add an attachment?')).toBeVisible();
      const sent = apiMock.waitForRequest('POST', '/messages');
      await chat.pick('Skip');

      await expect(chat.reply("Your support ticket has been submitted successfully! We'll get back to you soon.")).toBeVisible();
      expect((await sent).postDataJSON()).toMatchObject({
        name: `${guest.firstName} ${guest.lastName}`,
        email: guest.email,
        subject: contactSubjectSlug('Webmaster'),
        message: CONTACT_MESSAGE,
      });
    });
  });

  test.describe('when the search finds a product', { tag: ['@mocked'] }, () => {
    test.use({
      apiMocks: async ({ catalog }, use) => {
        const product = await catalog.inStock();
        await use({ routes: [mock.respond('QUERY', '/products/search', { ...paged([product]), per_page: 9 })] });
      },
    });

    test('its card shows the name and the price', async ({ homePage, catalog }) => {
      const { chat } = homePage.shell;
      const product = await catalog.inStock();
      await chat.open();

      await chat.findProduct(product.name);

      await expect(chat.reply('Here are some products I found:')).toBeVisible();
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
      await expect(chat.reply('What is your email address?')).toBeVisible();

      await chat.send('not-an-email');

      await expect(chat.reply('Please enter a valid email address.')).toBeVisible();
      await expect(chat.reply('Please select a subject for your ticket:')).toBeHidden();
      await apiMock.expectNoRequest('POST', '/messages');
    });

    test('a description under 50 characters is asked for again', async ({ homePage, apiMock }) => {
      const { chat } = homePage.shell;
      const guest = fakeGuest();
      await chat.send(guest.firstName);
      await chat.send(guest.lastName);
      await chat.send(guest.email);
      await chat.pick('Webmaster');
      await expect(chat.reply('Please describe your issue (minimum 50 characters):')).toBeVisible();

      await chat.send('too short');

      await expect(chat.reply('Your message must be at least 50 characters long.')).toBeVisible();
      await expect(chat.reply('Would you like to add an attachment?')).toBeHidden();
      await apiMock.expectNoRequest('POST', '/messages');
    });
  });

  test.describe('when the search finds nothing', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('QUERY', '/products/search', emptyProductPage())));

    test('the assistant says so', async ({ homePage }) => {
      const { chat } = homePage.shell;
      await chat.open();

      await chat.findProduct('hammer');

      await expect(chat.reply('No products found. Try a different search.')).toBeVisible();
    });
  });

  test.describe('when the search fails', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('QUERY', '/products/search', 500)));

    test('the assistant says it could not search', async ({ homePage, apiMock }) => {
      knownBug('BUG-25', 'a failed chat search answers "No products found", as if nothing matched.');
      const { chat } = homePage.shell;
      await chat.open();

      const searched = apiMock.waitForResponse('QUERY', '/products/search');
      await chat.findProduct('hammer');

      // Evidence that the failure path ran, whatever the chat then says: the search was refused and the question stayed in the transcript.
      expect((await searched).response.status()).toBe(500);
      await expect(chat.said('hammer')).toBeVisible();

      await expect(chat.reply(/could not|went wrong|error|try again later/i), 'BUG-25: the assistant says the search failed').toBeVisible({ timeout: 5_000 });
    });
  });
});
