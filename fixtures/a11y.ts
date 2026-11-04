import AxeBuilder from '@axe-core/playwright';
import { test as base } from '@playwright/test';
import type { AxeResults, Result } from 'axe-core';

/** WCAG 2.0, 2.1 and 2.2, levels A and AA. */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Left out of every scan, each for a stated reason. Everything else on the page is scanned,
 * the chat and live-activity widgets included, because they are part of the shop.
 */
export const EXCLUDED = [
  // The "Practice Black Box Testing & Bug Hunting" bar and its split-screen guide are a
  // training aid laid over the shop for testers, not part of the shop a customer uses.
  { selector: '.testing-guide-btn', reason: 'training aid, not part of the shop' },
  { selector: '.bug-hunting-btn', reason: 'training aid, not part of the shop' },
  { selector: '.guide-container', reason: 'training aid, not part of the shop' },
];

/**
 * One violation on one kind of element, the unit the known-violation baseline is kept in.
 * `target` is axe's CSS path with `:nth-child()` indices removed, so the same defect on repeated
 * elements (cards, filter groups) counts once, and the shared demo data adding a category
 * cannot turn a known violation into a "new" one.
 */
export interface Finding {
  rule: string;
  impact: string;
  target: string;
  wcag: string[];
  help: string;
}

export interface A11yScan {
  results: AxeResults;
  violations: Result[];
  findings: Finding[];
}

export interface A11yFixtures {
  /**
   * Scans the page as it is now and attaches the full axe result to the report.
   * `only` limits the scan to some rules, `within` to part of the page.
   */
  a11y: { scan: (name: string, options?: { only?: string[]; within?: string }) => Promise<A11yScan> };
}

export const test = base.extend<A11yFixtures>({
  a11y: async ({ page }, use, testInfo) => {
    await use({
      scan: async (name, { only, within } = {}) => {
        let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
        for (const { selector } of EXCLUDED) builder = builder.exclude(selector);
        if (only) builder = builder.withRules(only);
        if (within) builder = builder.include(within);
        const results = await builder.analyze();
        await testInfo.attach(`axe-${name}.json`, { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
        const seen = new Set<string>();
        const findings = results.violations.flatMap((v) =>
          v.nodes
            .map((n) => ({
              rule: v.id,
              impact: v.impact ?? 'unknown',
              target: n.target.join(' ').replace(/:nth-child\(\d+\)/g, ''),
              wcag: v.tags.filter((t) => /^wcag\d{3,}$/.test(t)).map((t) => t.slice(4).split('').join('.')),
              help: v.help,
            }))
            .filter((f) => !seen.has(f.rule + f.target) && seen.add(f.rule + f.target)),
        );
        return { results, violations: results.violations, findings };
      },
    });
  },
});
