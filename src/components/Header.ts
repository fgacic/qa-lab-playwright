import type { Locator } from '@playwright/test';
import { step } from '@support/step';
import { LanguageSwitcher } from './LanguageSwitcher';

export const CATEGORY_MENU = ['Hand Tools', 'Power Tools', 'Other', 'Special Tools', 'Rentals'] as const;
export type CategoryMenuItem = (typeof CATEGORY_MENU)[number];

export const ADMIN_SECTIONS = ['Dashboard', 'Brands', 'Categories', 'Products', 'Orders', 'Users', 'Messages', 'Settings'] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/** Test ids of the header items, for the language specs where the visible names change. */
export type NavKey = 'home' | 'categories' | 'contact' | 'sign-in' | 'hand-tools' | 'power-tools' | 'other' | 'special-tools' | 'rentals';

export class Header {
  readonly brandLink: Locator;
  readonly menuToggle: Locator;
  readonly homeLink: Locator;
  readonly categoriesButton: Locator;
  readonly contactLink: Locator;
  readonly signInLink: Locator;
  /** The cart link only exists while the cart holds something. Its name is just the count. */
  readonly cartLink: Locator;
  readonly userMenu: Locator;
  /** "Sign out" as assistive tech should see it: a link or a button. */
  readonly signOutControl: Locator;
  readonly language: LanguageSwitcher;

  constructor(private readonly root: Locator) {
    // "Practice Software Testing - Toolshop", translated except for the shop name.
    this.brandLink = root.getByRole('link', { name: / - Toolshop$/ });
    this.menuToggle = root.getByRole('button', { name: 'Toggle navigation' });
    this.homeLink = root.getByRole('link', { name: 'Home', exact: true });
    this.categoriesButton = root.getByRole('button', { name: 'Categories' });
    this.contactLink = root.getByRole('link', { name: 'Contact', exact: true });
    this.signInLink = root.getByRole('link', { name: 'Sign in', exact: true });
    this.cartLink = root.getByTestId('nav-cart');
    this.userMenu = root.getByTestId('nav-menu');
    this.signOutControl = root.getByRole('link', { name: 'Sign out' }).or(root.getByRole('button', { name: 'Sign out' }));
    this.language = new LanguageSwitcher(root);
  }

  navItem(key: NavKey): Locator {
    return this.root.getByTestId(`nav-${key}`);
  }

  categoryLink(name: CategoryMenuItem): Locator {
    return this.root.getByRole('link', { name, exact: true });
  }

  userMenuItem(name: 'My account' | 'My favorites' | 'My profile' | 'My invoices' | 'My messages' | 'Sign out'): Locator {
    // "Sign out" is an <a> without href, so it has no link role (A11Y-04); the test id reaches it.
    if (name === 'Sign out') return this.root.getByTestId('nav-sign-out');
    return this.root.getByRole('link', { name, exact: true });
  }

  /** Below 992 px the menu hides behind a toggler; open it so the links can be used. */
  @step('Expand the navigation menu if collapsed')
  async expand(): Promise<void> {
    if ((await this.menuToggle.isVisible()) && !(await this.homeLink.isVisible())) {
      await this.menuToggle.click();
    }
  }

  @step('Go to the home page via the logo')
  async goHomeViaLogo(): Promise<void> {
    await this.brandLink.click();
  }

  @step('Open "{0}" from the Categories menu')
  async openCategory(name: CategoryMenuItem): Promise<void> {
    await this.expand();
    await this.categoriesButton.click();
    await this.categoryLink(name).click();
  }

  @step('Open the cart')
  async openCart(): Promise<void> {
    await this.expand();
    await this.cartLink.click();
  }

  /** The admin's menu (named after the admin) lists the back-office sections. */
  adminMenuItem(name: AdminSection): Locator {
    return this.root.getByRole('list').getByRole('link', { name, exact: true });
  }

  @step('Open "{0}" from the admin menu')
  async openAdminSection(name: AdminSection): Promise<void> {
    await this.expand();
    await this.userMenu.click();
    await this.adminMenuItem(name).click();
  }

  @step('Open "{0}" from the account menu')
  async openUserMenuItem(name: Parameters<Header['userMenuItem']>[0]): Promise<void> {
    await this.expand();
    await this.userMenu.click();
    await this.userMenuItem(name).click();
  }
}
