import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
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
  private ran = 0;
  private challenged = 0;

  printsToStdio(): boolean {
    return false;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    if (process.argv.includes('--list')) return;
    const projects = new Set(suite.allTests().map((t) => t.parent.project()?.name));
    if (projects.has('perf') && projects.size > 1) {
      // An error thrown from a reporter is only logged and the run goes on, so this one stops the process itself,
      // before the first test starts: nothing has been measured next to anything else.
      console.error(
        `\nThe perf budgets must run alone, but this run also schedules ${[...projects].filter((p) => p !== 'perf').join(', ')}. ` +
          'Run `npm run test:perf` (--project=perf) in its own pass.',
      );
      process.exit(1);
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.ran++;
    if (result.status === 'skipped' && test.annotations.some((a) => a.type === 'skip' && a.description === BOT_CHALLENGE_REASON)) this.challenged++;
  }

  onEnd(): Promise<{ status: FullResult['status'] } | undefined> | undefined {
    if (!this.ran || this.challenged / this.ran <= MAX_BOT_CHALLENGE_SKIP_RATIO) return undefined;
    console.error(
      `\n${this.challenged} of ${this.ran} tests were skipped because Cloudflare challenged the run (more than ${MAX_BOT_CHALLENGE_SKIP_RATIO * 100}%): ` +
        'the run proves nothing about the shop, so it fails.',
    );
    return Promise.resolve({ status: 'failed' });
  }
}
