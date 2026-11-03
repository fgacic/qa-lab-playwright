import type { Locator } from '@playwright/test';
import { step } from '@support/step';

export const SORT_OPTIONS = {
  'Name (A - Z)': 'name,asc',
  'Name (Z - A)': 'name,desc',
  'Price (High - Low)': 'price,desc',
  'Price (Low - High)': 'price,asc',
  'CO₂ Rating (A - E)': 'co2_rating,asc',
  'CO₂ Rating (E - A)': 'co2_rating,desc',
} as const;
export type SortOption = keyof typeof SORT_OPTIONS;

/** Sort, price range and the category / brand / sustainability checkboxes in the sidebar. */
export class FilterPanel {
  readonly sort: Locator;
  readonly categories: Locator;
  readonly brands: Locator;
  readonly ecoFriendly: Locator;
  readonly minPrice: Locator;
  readonly maxPrice: Locator;
  /** On phones the whole sidebar, search included, folds behind this button. */
  readonly toggle: Locator;

  constructor(root: Locator) {
    this.toggle = root.getByRole('button', { name: 'Filters', exact: true });
    this.sort = root.getByRole('combobox', { name: 'sort' });
    // Each parent category nests a group of its own, also named "Categories": take the outer one.
    this.categories = root.getByRole('group', { name: 'Categories' }).first();
    this.brands = root.getByRole('group', { name: 'Brands' });
    this.ecoFriendly = root.getByRole('checkbox', { name: 'Show only eco-friendly products' });
    this.minPrice = root.getByRole('slider', { name: 'ngx-slider', exact: true });
    this.maxPrice = root.getByRole('slider', { name: 'ngx-slider-max' });
  }

  category(name: string): Locator {
    return this.categories.getByRole('checkbox', { name, exact: true });
  }

  brand(name: string): Locator {
    return this.brands.getByRole('checkbox', { name, exact: true });
  }

  @step('Unfold the filters if they are folded away')
  async expand(): Promise<void> {
    if ((await this.toggle.isVisible()) && !(await this.sort.isVisible())) await this.toggle.click();
  }

  @step('Sort by "{0}"')
  async sortBy(option: SortOption): Promise<void> {
    await this.expand();
    await this.sort.selectOption({ label: option });
  }

  @step('Filter by category "{0}"')
  async filterByCategory(name: string): Promise<void> {
    await this.expand();
    await this.category(name).check();
  }

  @step('Filter by brand "{0}"')
  async filterByBrand(name: string): Promise<void> {
    await this.expand();
    await this.brand(name).check();
  }

  @step('Show only eco-friendly products')
  async showOnlyEcoFriendly(): Promise<void> {
    await this.expand();
    await this.ecoFriendly.check();
  }

  /** The slider is keyboard operable: one arrow press moves a handle by one dollar. */
  @step('Lower the maximum price to ${0}')
  async setMaxPrice(max: number): Promise<void> {
    await this.expand();
    const current = Number(await this.maxPrice.getAttribute('aria-valuenow'));
    await this.maxPrice.focus();
    for (let value = current; value > max; value--) await this.maxPrice.press('ArrowLeft');
    for (let value = current; value < max; value++) await this.maxPrice.press('ArrowRight');
  }
}
