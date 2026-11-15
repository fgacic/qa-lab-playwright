import { mergeTests } from '@playwright/test';
import { AppShell } from '@pages/AppShell';
import { CategoryPage } from '@pages/CategoryPage';
import { CheckoutPage } from '@pages/CheckoutPage';
import { COMPARE_STORAGE_KEY, ComparisonPage } from '@pages/ComparisonPage';
import { ContactPage } from '@pages/ContactPage';
import { ForgotPasswordPage } from '@pages/ForgotPasswordPage';
import { HomePage } from '@pages/HomePage';
import { LoginPage } from '@pages/LoginPage';
import { ProductPage } from '@pages/ProductPage';
import { RegisterPage } from '@pages/RegisterPage';
import { RentalsPage } from '@pages/RentalsPage';
import { mock } from '@support/api-mock';
import { installToken } from '@support/session';
import type { CartItem, Product, ToolshopApi } from '@support/toolshop-api';
import { test as apiTest, type Catalog } from './api';
import { test as authTest } from './auth';
import { test as mocksTest } from './mocks';

export type ProductKind = 'in-stock' | 'another-in-stock' | 'out-of-stock' | 'eco' | 'rental';

export interface PageOptions {
  /** Which product `productPage` opens. */
  productKind: ProductKind;
  /** What `checkout` puts in the cart before opening it. An empty list means no cart at all. */
  cartItems: CartItem[];
  /** Products `comparisonPage` has selected for comparison. */
  comparedProducts: Product[];
  /**
   * Refuse (418, and fail the test) every write to the API that no mock answers, from the first
   * request on. For specs that mock the write they are about: a gap in the mocks then cannot write
   * to a real shop. Always on for live, where the page fixture already guards writes.
   */
  refuseUnmockedWrites: boolean;
}

/**
 * Two different in-stock products with no eco discount, 2 of the first and 1 of the second: the
 * cart the cart and purchase specs share. With neither product eco-friendly (and neither a rental),
 * the cart total is the plain sum of its lines, so a spec can state the figure instead of reading it.
 * `test.use({ cartItems: twoProductCart })`
 */
export const twoProductCart = async ({ catalog, api }: { catalog: Catalog; api: ToolshopApi }, use: (items: CartItem[]) => Promise<void>): Promise<void> => {
  const first = await catalog.nonEco();
  const second = await api.findProduct('second non-eco', (p) => p.in_stock && !p.is_rental && !p.is_eco_friendly && p.id !== first.id);
  await use([
    { product: first, quantity: 2 },
    { product: second, quantity: 1 },
  ]);
};

/**
 * An answer for GET /postcode-lookup, for specs that are not about the lookup: the address is then
 * filled from this and a lookup outage cannot fail them. Specs that mock other routes list it too,
 * since a describe's `withMocks` replaces the file's.
 */
export const POSTCODE_LOOKUP_RESULT = {
  street: 'Mockstraat',
  house_number: '1',
  city: 'Mockstad',
  state: 'Mockland',
  country: 'NL',
  postcode: '1234 AB',
};
export const postcodeLookupMock = mock.respond('GET', '/postcode-lookup', POSTCODE_LOOKUP_RESULT);

/**
 * Page fixtures. Each one builds its page object, does the setup the page needs (a cart, a
 * comparison) and opens it, so a test starts on the page it is about. `categoryPage` is the
 * exception: specs reach it through the header or call `open(slug)` themselves.
 */
export interface PageFixtures {
  product: Product;
  homePage: HomePage;
  productPage: ProductPage;
  /** `productPage` for a signed-in customer: the session is in place before the page opens. */
  signedInProductPage: ProductPage;
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
  shop: { home: HomePage; contact: ContactPage; login: LoginPage; appShell: AppShell };
}

export const test = mergeTests(apiTest, mocksTest, authTest).extend<PageOptions & PageFixtures>({
  productKind: ['in-stock', { option: true }],
  cartItems: [async ({ catalog }, use) => use([{ product: await catalog.inStock(), quantity: 1 }]), { option: true }],
  comparedProducts: [[], { option: true }],
  refuseUnmockedWrites: [false, { option: true }],

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
  // Depends on `signedIn` so the session exists before the page opens, whatever order a spec lists its fixtures in.
  signedInProductPage: async ({ page, product, signedIn: _ }, use) => {
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
    await page.addInitScript(
      ({ ids, key }) => {
        if (ids.length && !sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(ids));
      },
      { ids, key: COMPARE_STORAGE_KEY },
    );
    const comparisonPage = new ComparisonPage(page);
    await comparisonPage.open();
    await use(comparisonPage);
  },
  checkout: async ({ page, cartItems, seedCart, session, workerAccount, apiMock, refuseUnmockedWrites }, use) => {
    // Before the first request, so a write no mock answers is refused wherever it would come from.
    if (refuseUnmockedWrites) await apiMock.blockUnmockedWrites();
    // A real customer's session must be in place before /checkout loads (the step after the cart
    // differs for a signed-in customer), whatever order a spec lists its fixtures in. The mocked
    // session is not installed here: checkout specs are guests unless they ask for `signedIn`.
    if (session === 'worker-account') await installToken(page, (await workerAccount.get()).token);
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
  shop: async ({ page }, use) =>
    use({
      home: new HomePage(page),
      contact: new ContactPage(page),
      login: new LoginPage(page),
      appShell: new AppShell(page),
    }),
  contactPage: async ({ page }, use) => {
    const contactPage = new ContactPage(page);
    await contactPage.open();
    await use(contactPage);
  },
});
