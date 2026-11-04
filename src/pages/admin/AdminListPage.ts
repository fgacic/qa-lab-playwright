import type { Locator, Page } from '@playwright/test';
import { AdminSearch } from '@components/admin/AdminSearch';
import { AdminTable } from '@components/admin/AdminTable';
import { step } from '@support/step';
import { AppShell } from '../AppShell';

export interface AdminListConfig<Detail> {
  path: string;
  heading: string;
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
  readonly search: AdminSearch;
  readonly addLink: Locator;
  readonly table: AdminTable;
  readonly feedback: Locator;

  constructor(readonly page: Page, private readonly config: AdminListConfig<Detail>) {
    this.shell = new AppShell(page);
    this.heading = page.getByRole('heading', { name: config.heading, level: 1 });
    this.search = new AdminSearch(page.locator('body'), config.searchLabel ?? 'no search box');
    this.addLink = page.getByRole('link', { name: config.addLink ?? 'no add link' });
    this.table = new AdminTable(page.getByRole('table'));
    this.feedback = page.getByRole('alert');
  }

  @step('Open the admin list {0}')
  async open(): Promise<void> {
    await this.shell.goto(this.config.path);
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
