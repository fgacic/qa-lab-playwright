import type { Locator, Page } from '@playwright/test';
import { API_URL } from '@support/env';
import { step } from '@support/step';
import { AppShell } from './AppShell';
import { CheckoutPage } from './CheckoutPage';
import { ComparisonPage } from './ComparisonPage';

export class ProductPage {
  readonly shell: AppShell;
  readonly name: Locator;
  readonly price: Locator;
  readonly description: Locator;
  readonly ecoBadge: Locator;
  readonly outOfStock: Locator;
  readonly quantity: Locator;
  readonly increaseQuantityButton: Locator;
  readonly decreaseQuantityButton: Locator;
  readonly addToCartButton: Locator;
  readonly addToFavouritesButton: Locator;
  readonly compareButton: Locator;
  readonly specifications: Locator;
  readonly relatedHeading: Locator;
  readonly relatedProducts: Locator;
  readonly unavailableMessage: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.name = page.getByRole('heading', { level: 1 });
    this.price = page.getByTestId('unit-price');
    this.description = page.getByTestId('product-description');
    this.ecoBadge = page.getByTestId('eco-badge');
    this.outOfStock = page.getByText('Out of stock', { exact: true });
    this.quantity = page.getByRole('spinbutton', { name: 'Quantity' });
    this.increaseQuantityButton = page.getByRole('button', { name: 'Increase quantity' });
    this.decreaseQuantityButton = page.getByRole('button', { name: 'Decrease quantity' });
    this.addToCartButton = page.getByRole('button', { name: 'Add to cart' });
    this.addToFavouritesButton = page.getByRole('button', { name: 'Add to favourites' });
    this.compareButton = page.getByRole('button', { name: 'Compare', exact: true });
    this.specifications = page.getByRole('table').getByRole('row');
    this.relatedHeading = page.getByRole('heading', { name: 'Related products' });
    this.relatedProducts = page.getByRole('link').filter({ has: page.getByRole('heading', { level: 5 }) });
    this.unavailableMessage = page.getByText(/not found|no longer available|unavailable/i);
  }

  get header() {
    return this.shell.header;
  }

  get toast() {
    return this.shell.toast;
  }

  /** The product's picture, found by the name the shop gives it as alt text (the related products have pictures of their own). */
  image(productName: string): Locator {
    return this.page.getByRole('img', { name: productName, exact: true });
  }

  specification(name: string): Locator {
    return this.specifications.filter({ has: this.page.getByRole('cell', { name, exact: true }) });
  }

  /** The ids of the related products, read from their links (`/product/<id>`), once they have rendered. */
  async relatedIds(): Promise<string[]> {
    await this.relatedProducts.first().waitFor();
    const hrefs = await this.relatedProducts.evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    return hrefs.map((href) => href.split('/').pop() ?? '');
  }

  /** The name a related product's card shows. */
  relatedName(index: number): Locator {
    return this.relatedProducts.nth(index).getByRole('heading', { level: 5 });
  }

  @step('Open the product page /product/{0}')
  async open(productId: string): Promise<void> {
    await this.shell.gotoAndSettle(`/product/${productId}`, 'GET', /^\/products\/[^/]+$/);
  }

  /** Typed quantities are clamped when the field loses focus. */
  @step('Type quantity {0}')
  async typeQuantity(quantity: number | string): Promise<void> {
    await this.quantity.fill(String(quantity));
    await this.quantity.blur();
  }

  @step('Add {0} to the cart')
  async addToCart(quantity = 1): Promise<void> {
    if (quantity !== 1) await this.typeQuantity(quantity);
    await this.addToCartButton.click();
  }

  @step('Add the product to favourites')
  async addToFavourites(): Promise<void> {
    await this.addToFavouritesButton.click();
  }

  @step('Add the product to the comparison')
  async compare(): Promise<void> {
    await this.compareButton.click();
  }

  @step('Open the cart from the header')
  async openCart(): Promise<CheckoutPage> {
    await this.header.openCart();
    return new CheckoutPage(this.page);
  }

  /** Back to the overview, waiting for its product list so a later search is not overwritten. */
  @step('Go back to the shop via the logo')
  async backToShop(): Promise<void> {
    const listed = this.page.waitForResponse((r) => r.url() === `${API_URL}/products` && r.request().method() === 'QUERY');
    await this.header.goHomeViaLogo();
    await listed;
  }

  @step('Open the comparison')
  async openComparison(): Promise<ComparisonPage> {
    const comparison = new ComparisonPage(this.page);
    await comparison.open();
    return comparison;
  }

  @step('Open the related product number {0}')
  async openRelated(index: number): Promise<void> {
    await this.relatedProducts.nth(index).click();
  }
}
