import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { emptyProductPage } from '@support/payloads';
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

      expect((await sent).postDataJSON()).toMatchObject({
        name: `${guest.firstName} ${guest.lastName}`,
        email: guest.email,
        subject: 'webmaster',
        message: CONTACT_MESSAGE,
      });
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

    test('the assistant says it could not search', async ({ homePage }) => {
      knownBug('BUG-25', 'a failed chat search answers "No products found", as if nothing matched.');
      const { chat } = homePage.shell;
      await chat.open();

      await chat.findProduct('hammer');

      await expect(chat.reply(/could not|went wrong|error|try again later/i), 'BUG-25: the assistant says the search failed').toBeVisible({ timeout: 5_000 });
    });
  });
});
