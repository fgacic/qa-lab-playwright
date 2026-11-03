import { CATEGORY_MENU, type CategoryMenuItem } from '@components/Header';
import { expect, test } from '@fixtures';

test.describe('Header navigation', () => {
  test('the logo takes the shopper back to the home page', { tag: ['@smoke'] }, async ({ contactPage, page }) => {
    await contactPage.shell.header.goHomeViaLogo();

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Practice Software Testing - Toolshop', level: 1 })).toBeVisible();
  });

  // Each link starts from a product page, which none of them points to, so the click must navigate.
  const links = [
    { label: 'Home', link: 'homeLink', path: '/', heading: 'Practice Software Testing - Toolshop' },
    { label: 'Contact', link: 'contactLink', path: '/contact', heading: 'Contact' },
    { label: 'Sign in', link: 'signInLink', path: '/auth/login', heading: 'Login' },
  ] as const;

  for (const { label, link, path, heading } of links) {
    test(`"${label}" goes to ${path}`, { tag: ['@smoke'] }, async ({ productPage, page }) => {
      const header = productPage.header;
      await header.expand();
      await header[link].click();

      await expect(page).toHaveURL(path);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    });
  }

  const categoryPages: Record<CategoryMenuItem, { path: string; title: string }> = {
    'Hand Tools': { path: '/category/hand-tools', title: 'Category: Hand Tools' },
    'Power Tools': { path: '/category/power-tools', title: 'Category: Power Tools' },
    Other: { path: '/category/other', title: 'Category: Other' },
    'Special Tools': { path: '/category/special-tools', title: 'Category: Special Tools' },
    Rentals: { path: '/rentals', title: 'Rentals' },
  };

  for (const item of CATEGORY_MENU) {
    test(`the Categories menu opens "${item}"`, async ({ homePage, page }) => {
      await homePage.header.openCategory(item);

      await expect(page).toHaveURL(categoryPages[item].path);
      await expect(page.getByTestId('page-title')).toHaveText(categoryPages[item].title);
    });
  }

  test('the cart link is absent while the cart is empty', { tag: ['@negative'] }, async ({ homePage }) => {
    await expect(homePage.grid.cards.first()).toBeVisible();
    await expect(homePage.header.cartLink).toHaveCount(0);
  });

  test.describe('with two items in the cart', () => {
    test.use({ cartItems: async ({ catalog }, use) => use([{ product: await catalog.inStock(), quantity: 2 }]) });

    test('the cart link shows the item count and opens the cart', async ({ checkout, page }) => {
      await expect(checkout.header.cartLink).toHaveText('2');

      await checkout.header.goHomeViaLogo();
      await checkout.header.openCart();

      await expect(page).toHaveURL('/checkout');
      await expect(checkout.cart.table.rows).toHaveCount(1);
    });
  });

  test('a signed-out shopper sees "Sign in" and no account menu', { tag: ['@negative'] }, async ({ homePage }) => {
    await homePage.header.expand();
    await expect(homePage.header.signInLink).toBeVisible();
    await expect(homePage.header.userMenu).toHaveCount(0);
  });

  test('on a phone the menu hides behind a toggle that reveals it', { tag: ['@mobile'] }, async ({ homePage, isMobile }) => {
    test.skip(!isMobile, 'The toggle only exists below the 992 px breakpoint.');
    const { header } = homePage;
    await expect(header.homeLink).toBeHidden();

    await header.menuToggle.click();

    await expect(header.homeLink).toBeVisible();
    await expect(header.contactLink).toBeVisible();
  });
});
