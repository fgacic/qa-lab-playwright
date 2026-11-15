import { test, type Locator, type Page } from '@playwright/test';
import { AdminSearch } from '@components/admin/AdminSearch';
import { AdminTable } from '@components/admin/AdminTable';
import { Pagination } from '@components/Pagination';
import type { HttpMethod } from '@support/api-mock';
import { step } from '@support/step';
import { AppShell } from '../AppShell';

export interface AdminListConfig<Detail> {
  path: string;
  heading: string;
  /** The request that fills the table; `open()` returns once it has been answered. */
  feed: { method: HttpMethod; path: RegExp };
  /** Accessible name of the search box, if the list has one. */
  searchLabel?: string;
  /** Name of the "Add …" link, if records can be created. */
  addLink?: string;
  /** The page an Add, Edit or Details click leads to. */
  detail: (page: Page) => Detail;
}

/**
 * Every back-office list (products, brands, categories, orders, users, messages) is the same
 * shape: heading, optional search and Add link, a table. One class, configured per list.
 */
export class AdminListPage<Detail> {
  readonly shell: AppShell;
  readonly heading: Locator;
  readonly table: AdminTable;
  /** Only drawn when the list has more than one page. */
  readonly pagination: Pagination;
  readonly feedback: Locator;

  constructor(readonly page: Page, private readonly config: AdminListConfig<Detail>) {
    this.shell = new AppShell(page);
    this.heading = page.getByRole('heading', { name: config.heading, level: 1 });
    this.table = new AdminTable(page.getByRole('table'));
    this.pagination = new Pagination(page.getByRole('navigation').filter({ has: page.getByRole('button', { name: 'Previous' }) }));
    this.feedback = page.getByRole('alert');
  }

  /** The search box above the table. Lists without one (messages) refuse the question, instead of timing out on a made-up label. */
  get search(): AdminSearch {
    const { searchLabel } = this.config;
    if (!searchLabel) throw new Error(`The "${this.config.heading}" list has no search box.`);
    return new AdminSearch(this.page.locator('body'), searchLabel);
  }

  /** The "Add ..." link. Lists whose records cannot be created here (orders, messages) refuse the question. */
  get addLink(): Locator {
    const { addLink } = this.config;
    if (!addLink) throw new Error(`The "${this.config.heading}" list has no Add link.`);
    return this.page.getByRole('link', { name: addLink });
  }

  /** The alert that carries `text` ("Brand deleted.", the API's reason for a refusal...). */
  alert(text: string | RegExp): Locator {
    return this.feedback.filter({ hasText: text });
  }

  // Not @step: the title names the list, which only the instance knows.
  async open(): Promise<void> {
    await test.step(`Open the admin list "${this.config.heading}"`, () => this.shell.gotoAndSettle(this.config.path, this.config.feed.method, this.config.feed.path), { box: true });
  }

  @step('Start a new record')
  async add(): Promise<Detail> {
    await this.addLink.click();
    return this.config.detail(this.page);
  }

  @step('Edit "{0}"')
  async edit(text: string): Promise<Detail> {
    await this.table.edit(text);
    return this.config.detail(this.page);
  }

  @step('Open "{0}"')
  async details(text: string): Promise<Detail> {
    await this.table.details(text);
    return this.config.detail(this.page);
  }
}
