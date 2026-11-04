import { test as base } from '@playwright/test';
import * as allure from 'allure-js-commons';
import path from 'node:path';

/**
 * Allure labels for every test, derived instead of written by hand: epic from the spec's folder,
 * feature from the spec file, story from the innermost describe, severity from the tags, layer
 * from how the test reaches the shop. They feed the report's Graphs (features, epics, stories,
 * severities, layers, testing pyramid).
 */
const EPICS: Record<string, string> = {
  navigation: 'Shop', catalog: 'Catalog', product: 'Catalog', cart: 'Cart', checkout: 'Checkout',
  auth: 'Account', account: 'Account', contact: 'Support', widgets: 'Support',
  admin: 'Back office', 'admin-e2e': 'Back office', setup: 'Setup',
  a11y: 'Quality', visual: 'Quality', performance: 'Quality', security: 'Quality', i18n: 'Quality',
};

/** First match wins: what breaks the most when it fails. */
const SEVERITY: [RegExp, 'blocker' | 'critical' | 'normal' | 'minor' | 'trivial'][] = [
  [/@flow/, 'blocker'],
  [/@smoke/, 'critical'],
  [/@security|@admin|@account/, 'critical'],
  [/@a11y|@i18n|@visual|@perf/, 'minor'],
];

/** Testing-pyramid vocabulary, so the pyramid and by-layer widgets render. */
function layerOf(tags: string[], project: string): string {
  if (project === 'visual' || tags.includes('@visual')) return 'visual';
  if (tags.includes('@mocked')) return 'integration';
  return 'e2e';
}

const humanise = (s: string) => s.replace(/[-_.]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export const test = base.extend<{ allureLabels: void }>({
  allureLabels: [
    async ({}, use, testInfo) => {
      const relative = path.relative(testInfo.project.testDir, testInfo.file);
      const [folder] = relative.split(path.sep);
      const file = path.basename(relative).replace(/(\.e2e|\.a11y|\.visual)?\.(spec|setup)\.ts$/, '');
      const describes = testInfo.titlePath.slice(1, -1);
      const tags = testInfo.tags;
      await allure.epic(EPICS[folder] ?? humanise(folder));
      await allure.feature(humanise(file));
      if (describes.length) await allure.story(describes.at(-1)!);
      await allure.severity(SEVERITY.find(([tag]) => tags.some((t) => tag.test(t)))?.[1] ?? 'normal');
      await allure.layer(layerOf(tags, testInfo.project.name));
      await use();
    },
    { auto: true },
  ],
});
