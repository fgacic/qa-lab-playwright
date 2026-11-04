import { mergeTests } from '@playwright/test';
import { CategoryPage } from '@pages/CategoryPage';
import { CheckoutPage } from '@pages/CheckoutPage';
import { ComparisonPage } from '@pages/ComparisonPage';
import { ContactPage } from '@pages/ContactPage';
import { ForgotPasswordPage } from '@pages/ForgotPasswordPage';
import { HomePage } from '@pages/HomePage';
import { LoginPage } from '@pages/LoginPage';
import { ProductPage } from '@pages/ProductPage';
import { RegisterPage } from '@pages/RegisterPage';
import { RentalsPage } from '@pages/RentalsPage';
import type { CartItem, Product } from '@support/toolshop-api';
import { test as apiTest } from './api';
import { test as mocksTest } from './mocks';

export type ProductKind = 'in-stock' | 'another-in-stock' | 'out-of-stock' | 'eco' | 'rental';

export interface PageOptions {
  /** Which product `productPage` opens. */
  productKind: ProductKind;
  /** What `checkout` puts in the cart before opening it. An empty list means no cart at all. */
  cartItems: CartItem[];
  /** Products `comparisonPage` has selected for comparison. */
  comparedProducts: Product[];
}

/**
 * Page fixtures. Each one builds its page object, does the setup the page needs (a cart, a
 * comparison) and opens it, so a test starts on the page it is about. `categoryPage` is the
 * exception: specs reach it through the header or call `open(slug)` themselves.
 */
export interface PageFixtures {
  product: Product;
  homePage: HomePage;
  productPage: ProductPage;
  categoryPage: CategoryPage;
  rentalsPage: RentalsPage;
  comparisonPage: ComparisonPage;
  checkout: CheckoutPage;
  loginPage: LoginPage;
  registerPage: RegisterPage;
  forgotPasswordPage: ForgotPasswordPage;
  contactPage: ContactPage;
  /**
   * Page objects that are not opened yet, for journeys that move between areas (back office,
   * then shop): the test opens them when the story gets there.
   */
  shop: { home: HomePage };
}

export const test = mergeTests(apiTest, mocksTest).extend<PageOptions & PageFixtures>({
  productKind: ['in-stock', { option: true }],
  cartItems: [async ({ catalog }, use) => use([{ product: await catalog.inStock(), quantity: 1 }]), { option: true }],
  comparedProducts: [[], { option: true }],

  product: async ({ catalog, productKind }, use) => {
    const lookup = {
      'in-stock': catalog.inStock,
      'another-in-stock': catalog.anotherInStock,
      'out-of-stock': catalog.outOfStock,
      eco: catalog.eco,
      rental: catalog.rental,
    } satisfies Record<ProductKind, () => Promise<Product>>;
    await use(await lookup[productKind]());
  },
  homePage: async ({ page }, use) => {
    const homePage = new HomePage(page);
    await homePage.open();
    await use(homePage);
  },
  productPage: async ({ page, product }, use) => {
    const productPage = new ProductPage(page);
    await productPage.open(product.id);
    await use(productPage);
  },
  categoryPage: async ({ page }, use) => {
    await use(new CategoryPage(page));
  },
  rentalsPage: async ({ page }, use) => {
    const rentalsPage = new RentalsPage(page);
    await rentalsPage.open();
    await use(rentalsPage);
  },
  comparisonPage: async ({ page, comparedProducts }, use) => {
    const ids = comparedProducts.map((p) => p.id);
    await page.addInitScript((ids) => {
      if (ids.length && !sessionStorage.getItem('compare_ids')) sessionStorage.setItem('compare_ids', JSON.stringify(ids));
    }, ids);
    const comparisonPage = new ComparisonPage(page);
    await comparisonPage.open();
    await use(comparisonPage);
  },
  checkout: async ({ page, cartItems, seedCart }, use) => {
    if (cartItems.length) await seedCart(cartItems);
    const checkout = new CheckoutPage(page);
    await checkout.open();
    await use(checkout);
  },
  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await loginPage.open();
    await use(loginPage);
  },
  registerPage: async ({ page }, use) => {
    const registerPage = new RegisterPage(page);
    await registerPage.open();
    await use(registerPage);
  },
  forgotPasswordPage: async ({ page }, use) => {
    const forgotPasswordPage = new ForgotPasswordPage(page);
    await forgotPasswordPage.open();
    await use(forgotPasswordPage);
  },
  shop: async ({ page }, use) => use({ home: new HomePage(page) }),
  contactPage: async ({ page }, use) => {
    const contactPage = new ContactPage(page);
    await contactPage.open();
    await use(contactPage);
  },
});
