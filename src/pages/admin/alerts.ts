import type { Locator } from '@playwright/test';

/**
 * Whether `alerts` shows anything within `within` ms: the way to observe that nothing is announced.
 * An absence cannot be read off one snapshot (`toHaveCount(0)` passes the instant it is taken, before a
 * response that is still on its way has been drawn), so this watches for an appearance and reports
 * whether one came. Call it after anchoring on content that is rendered last, and once per scenario:
 * a passing test pays the whole window.
 */
export async function alertAppears(alerts: Locator, within = 750): Promise<boolean> {
  return alerts.first().waitFor({ state: 'visible', timeout: within }).then(() => true, () => false);
}
