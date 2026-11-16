import AxeBuilder from '@axe-core/playwright';
import { expect, test as base } from '@playwright/test';
import type { Locator } from '@playwright/test';
import type { AxeResults, Result } from 'axe-core';
import type { ScanName } from '@support/a11y-baseline';

/** A search term nothing in the shop matches: the "no results" state of the scans, the pins and the translation visits. */
export const NO_SUCH_PRODUCT = 'qa-lab-no-such-product';

/** WCAG 2.0, 2.1 and 2.2, levels A and AA. */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Left out of every scan, each for a stated reason. Everything else on the page is scanned,
 * the chat and live-activity widgets included, because they are part of the shop. `shownBy` is the control that
 * brings up something that is not drawn at first, so a check that the selector still exists can open it.
 */
export const EXCLUDED: { selector: string; reason: string; shownBy?: string }[] = [
  // The "Practice Black Box Testing & Bug Hunting" bar's "Testing Guide" button and the split-screen guide it opens are a
  // training aid laid over the shop for testers, not part of the shop a customer uses.
  { selector: '.testing-guide-btn', reason: 'training aid, not part of the shop' },
  { selector: '.guide-container', reason: 'training aid, not part of the shop; drawn only once the bar\'s "Testing Guide" button opens it', shownBy: '.testing-guide-btn' },
];

/**
 * One violation on one kind of element, the unit the known-violation baseline is kept in.
 * `target` is axe's CSS path with `:nth-child()` indices removed, so the same defect on repeated
 * elements (cards, filter groups) counts once, and the shared demo data adding a category
 * cannot turn a known violation into a "new" one. `nodes` is how many elements the finding
 * stands for, so a defect that spreads to more elements of the same kind is still seen.
 */
export interface Finding {
  rule: string;
  impact: string;
  target: string;
  wcag: string[];
  help: string;
  nodes: number;
}

/** axe's tags name a success criterion without dots: wcag143 is 1.4.3, wcag1410 is 1.4.10, wcag2411 is 2.4.11. */
export function wcagCriteria(tags: string[]): string[] {
  return tags.flatMap((tag) => {
    const [, principle, guideline, criterion] = /^wcag(\d)(\d)(\d+)$/.exec(tag) ?? [];
    return criterion ? [`${principle}.${guideline}.${criterion}`] : [];
  });
}

export interface A11yScan {
  results: AxeResults;
  violations: Result[];
  findings: Finding[];
}

export interface A11yFixtures {
  /**
   * Scans the page as it is now and attaches the full axe result to the report.
   * `ready` is the scan-ready step every scan shares, and every scan must give it: the content the state
   * draws last, each of which must be visible before axe reads the page (a scan that ran before it
   * rendered would pass for the wrong reason, so an empty list is a compile error). `only` limits the scan
   * to some rules, `within` to part of the page.
   *
   * The scan expects the page to be at rest: the specs run with `reducedMotion: 'reduce'` set on the
   * context before any navigation, so no transition or fade is ever caught half way (read as low contrast).
   */
  a11y: { scan: (name: ScanName, options: { ready: [Locator, ...Locator[]]; only?: string[]; within?: string }) => Promise<A11yScan> };
}

export const test = base.extend<A11yFixtures>({
  a11y: async ({ page }, use, testInfo) => {
    await use({
      scan: async (name, { ready, only, within }) => {
        for (const content of ready) await expect(content.first(), `${name}: the state to be rendered before it is scanned`).toBeVisible();
        // Set on the context by the spec, before the page loaded, so the page's own scripts saw it too; a spec that forgot it would scan mid-fade.
        expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), `${name}: the spec must run with reducedMotion: 'reduce'`).toBe(true);
        // Either the named rules or the whole WCAG set, never one narrowing the other.
        let builder = only ? new AxeBuilder({ page }).withRules(only) : new AxeBuilder({ page }).withTags(WCAG_TAGS);
        for (const { selector } of EXCLUDED) builder = builder.exclude(selector);
        if (within) builder = builder.include(within);
        const results = await builder.analyze();
        const file = name.replaceAll(' ', '-') + (only ? `-${only.join('+')}` : '');
        await testInfo.attach(`axe-${file}.json`, { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
        // "Needs review" results are not violations and are attached, not gated: what axe cannot decide (text over an image or a gradient,
        // a name that depends on a computed style) follows the shop's data and pictures, so a count or a list per scan would be as unstable as
        // the seed it reads, and a gate on it would turn red for a product photo. The violations ratchet and the pins are the gate.
        await testInfo.attach(`axe-${file}-incomplete.txt`, { body: `${results.incomplete.length} incomplete: ${results.incomplete.map((r) => r.id).join(', ') || 'none'}`, contentType: 'text/plain' });
        const byTarget = new Map<string, Finding>();
        for (const v of results.violations) {
          for (const n of v.nodes) {
            // A target inside a frame or a shadow root is a nested list of selectors: flattened, so it reads as one path and not "a,b".
            const target = n.target.flat(Infinity).join(' ').replace(/:nth-child\(\d+\)/g, '');
            // Keyed by rule AND target with a separator neither can contain, so no rule/target pair can collide with another.
            const key = `${v.id}\u0000${target}`;
            const found = byTarget.get(key);
            if (found) found.nodes++;
            else byTarget.set(key, { rule: v.id, impact: v.impact ?? 'unknown', target, wcag: wcagCriteria(v.tags), help: v.help, nodes: 1 });
          }
        }
        const findings = [...byTarget.values()];
        return { results, violations: results.violations, findings };
      },
    });
  },
});
