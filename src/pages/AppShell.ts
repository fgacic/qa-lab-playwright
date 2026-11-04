import type { Locator, Page } from '@playwright/test';
import { ChatWidget } from '@components/ChatWidget';
import { Footer } from '@components/Footer';
import { Header } from '@components/Header';
import { LiveActivityPanel } from '@components/LiveActivityPanel';
import { PromoBanners } from '@components/PromoBanners';
import { Toast } from '@components/Toast';
import { API_URL, apiPath } from '@support/env';

/**
 * What every route shares: header, footer, banners, toasts and the two floating widgets.
 * Pages hold one of these (composition), they do not extend it.
 */
export class AppShell {
  readonly header: Header;
  readonly footer: Footer;
  readonly banners: PromoBanners;
  readonly toast: Toast;
  readonly chat: ChatWidget;
  readonly liveActivity: LiveActivityPanel;
  /**
   * Any alert that tells the user something went wrong. The bug specs use it to state what a
   * failed request should lead to, without prescribing the exact wording.
   */
  readonly errorAlert: Locator;

  constructor(readonly page: Page) {
    // Scoped by the menubar: the logo's name is translated, and on phones the menubar is
    // collapsed (hidden), hence includeHidden.
    this.header = new Header(page.getByRole('navigation').filter({ has: page.getByRole('menubar', { includeHidden: true }) }));
    this.footer = new Footer(page.getByRole('contentinfo'));
    this.banners = new PromoBanners(page);
    this.toast = new Toast(page);
    this.chat = new ChatWidget(page);
    this.liveActivity = new LiveActivityPanel(page);
    this.errorAlert = page.getByRole('alert').filter({ hasText: /error|wrong|fail|unavailable|try again|could not|not found/i });
  }

  /** `domcontentloaded`: the live-activity feed keeps a connection open, so `load`-idle never settles. */
  async goto(path: string): Promise<void> {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
  }

  /**
   * Opens a route and waits until the request that feeds it has settled, answered or failed.
   * Without this, a slow initial product list can land after the test's first search or
   * filter and overwrite its results.
   */
  async gotoAndSettle(path: string, method: string, feed: RegExp): Promise<void> {
    const isFeed = (url: string, m: string) => m === method && feed.test(apiPath(url)) && url.startsWith(API_URL);
    const settled = Promise.race([
      this.page.waitForResponse((r) => isFeed(r.url(), r.request().method())),
      this.page.waitForEvent('requestfailed', (r) => isFeed(r.url(), r.method())),
    ]).catch(() => undefined);
    await this.goto(path);
    await settled;
  }
}
