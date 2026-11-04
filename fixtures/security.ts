import { test as base, type Page } from '@playwright/test';

/**
 * Injection payloads, typed into forms as plain text; the specs then check the text comes back as
 * text. If the page ever executes one, it opens an alert ("qa-lab-xss"), which the sentinel
 * records. All are under 40 characters, the longest search the shop accepts (BUG-27).
 */
export const XSS_PAYLOADS = {
  'img onerror': `<img src=x onerror=alert('qa-lab-xss')>`,
  'script tag': `<script>alert('qa-lab-xss')</script>`,
  'svg onload, breaking out of an attribute': `"><svg onload=alert('qa-lab-xss')>`,
} as const;
export type XssPayload = (typeof XSS_PAYLOADS)[keyof typeof XSS_PAYLOADS];

export class XssSentinel {
  private readonly dialogs: string[] = [];

  constructor(private readonly page: Page) {
    page.on('dialog', async (dialog) => {
      this.dialogs.push(dialog.message());
      await dialog.dismiss();
    });
  }

  /** True if any payload ran: a "qa-lab-xss" alert opened on this page. */
  async executed(): Promise<boolean> {
    // Give an onerror / onload handler the chance to fire before answering.
    await this.page.waitForTimeout(500);
    return this.dialogs.some((m) => m.includes('qa-lab-xss'));
  }

  /** Elements a payload would have created had it been parsed as HTML (CSS: they have no role). */
  injectedElements() {
    return this.page.locator('img[src="x"], svg[onload*="qa-lab-xss"]').or(this.page.locator('script', { hasText: 'qa-lab-xss' }));
  }
}

export interface SecurityFixtures {
  xss: XssSentinel;
}

export const test = base.extend<SecurityFixtures>({
  xss: async ({ page }, use) => use(new XssSentinel(page)),
});
