import type { FullConfig, FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';
import { BOT_CHALLENGE_REASON, MAX_BOT_CHALLENGE_SKIP_RATIO } from './bot-challenge';

/**
 * Two guards that need to see the whole run, so they live in a reporter rather than in a spec:
 * - The perf budgets are measured alone (`workers: 1` limits only the perf project). A run that
 *   schedules perf tests next to tests of another project is refused before anything starts.
 * - A test that lands on the Cloudflare bot challenge is skipped, never failed (src/support/bot-challenge.ts),
 *   so a fully challenged live run would end green with everything skipped. The run fails when more
 *   than MAX_BOT_CHALLENGE_SKIP_RATIO of the tests were skipped for that reason.
 */
export default class RunGuardReporter implements Reporter {
  private suite?: Suite;

  printsToStdio(): boolean {
    return false;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.suite = suite;
    if (process.argv.includes('--list')) return;
    const projects = new Set(suite.allTests().map((t) => t.parent.project()?.name));
    if (projects.has('perf') && projects.size > 1) {
      // An error thrown from a reporter is only logged and the run goes on, so this one stops the process itself,
      // before the first test starts: nothing has been measured next to anything else. The process ends here,
      // so the other reporters (HTML, blob, Allure) write nothing for this run: its output is partial by design.
      console.error(
        `\nThe perf budgets must run alone, but this run also schedules ${[...projects].filter((p) => p !== 'perf').join(', ')}. ` +
          'Run `npm run test:perf` (--project=perf) in its own pass.',
      );
      process.exit(1);
    }
  }

  /**
   * Counted here, from each test's final outcome, not in `onTestEnd`: that fires once per attempt, so a
   * retried test would be counted twice and a flaky challenge counted as skipped though it later passed.
   * Setup projects (the sign-ins other projects depend on) are not tests of the shop and stay out of the ratio.
   */
  onEnd(): Promise<{ status: FullResult['status'] } | undefined> | undefined {
    const tests = this.suite?.allTests().filter((t) => !isSetup(t)) ?? [];
    const challenged = tests.filter(
      (t) => t.outcome() === 'skipped' && t.annotations.some((a) => a.type === 'skip' && a.description === BOT_CHALLENGE_REASON),
    ).length;
    if (!tests.length || challenged / tests.length <= MAX_BOT_CHALLENGE_SKIP_RATIO) return undefined;
    console.error(
      `\n${challenged} of ${tests.length} tests were skipped because Cloudflare challenged the run (more than ${MAX_BOT_CHALLENGE_SKIP_RATIO * 100}%): ` +
        'the run proves nothing about the shop, so it fails.',
    );
    return Promise.resolve({ status: 'failed' });
  }
}

/** A test of a setup project (`account-setup`, `admin-setup`): the sign-in other projects depend on, not a test of the shop. */
function isSetup(test: TestCase): boolean {
  return test.parent.project()?.name.endsWith('-setup') ?? false;
}
