import type { Locator } from '@playwright/test';
import { step } from '@support/step';

export class ProductCard {
  readonly name: Locator;
  readonly price: Locator;
  readonly compareButton: Locator;
  readonly outOfStock: Locator;

  constructor(readonly root: Locator) {
    this.name = root.getByRole('heading', { level: 5 });
    this.price = root.getByTestId('product-price');
    this.compareButton = root.getByRole('button', { name: 'Compare' });
    this.outOfStock = root.getByText('Out of stock', { exact: true });
  }
}

/** The product overview: a grid of cards, each a link to the product with its name as a heading. */
export class ProductGrid {
  readonly cards: Locator;
  readonly names: Locator;
  readonly prices: Locator;
  readonly emptyState: Locator;

  /** `cards` defaults to the shop grid; rentals render cards as plain elements and pass their own. */
  constructor(root: Locator, cards?: Locator) {
    this.cards = cards ?? root.getByRole('link').filter({ has: root.page().getByRole('heading', { level: 5 }) });
    this.names = this.cards.getByRole('heading', { level: 5 });
    this.prices = this.cards.getByTestId('product-price');
    this.emptyState = root.getByText('There are no products found.');
  }

  card(name: string): ProductCard {
    return new ProductCard(this.cards.filter({ has: this.cards.page().getByRole('heading', { name, exact: true }) }).first());
  }

  /** The first card that is not marked out of stock. */
  firstInStock(): ProductCard {
    return new ProductCard(this.cards.filter({ hasNot: this.cards.page().getByText('Out of stock', { exact: true }) }).first());
  }

  first(): ProductCard {
    return new ProductCard(this.cards.first());
  }

  nth(index: number): ProductCard {
    return new ProductCard(this.cards.nth(index));
  }

  /** Card names in display order, once the grid has rendered. */
  async productNames(): Promise<string[]> {
    await this.names.first().waitFor();
    return this.names.allInnerTexts();
  }

  /** Card prices as numbers, in display order. */
  async priceValues(): Promise<number[]> {
    return (await this.prices.allInnerTexts()).map((text) => Number(text.replace(/[^0-9.]/g, '')));
  }

  @step('Open the product "{0}"')
  async open(name: string): Promise<void> {
    await this.card(name).root.click();
  }

  @step('Add "{0}" to the comparison')
  async compare(name: string): Promise<void> {
    await this.card(name).compareButton.click();
  }
}
