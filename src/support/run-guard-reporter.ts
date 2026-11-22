import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';
import { BOT_CHALLENGE_REASON } from './bot-challenge';
import { perfAloneViolation, skipRatioViolation } from './run-guard';

/**
 * Two guards that need to see the whole run, so they live in a reporter rather than in a spec:
 * - The perf budgets are measured alone (`workers: 1` limits only the perf project). A run that
 *   schedules perf tests next to tests of another project is refused before anything starts.
 * - A test that lands on the Cloudflare bot challenge is skipped, never failed (src/support/bot-challenge.ts),
 *   so a fully challenged live run would end green with everything skipped. The run fails when more
 *   than MAX_BOT_CHALLENGE_SKIP_RATIO of the tests were skipped for that reason.
 *
 * A command-line `--reporter` replaces the configured reporters, this one included: the skip-ratio check is then off
 * (a local, ad-hoc run; CI and `npm test` never pass one). The perf rule does not depend on this reporter: the config
 * enforces it at load time too (playwright.config.ts).
 */
export default class RunGuardReporter implements Reporter {
  private suite?: Suite;

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.suite = suite;
    if (process.argv.includes('--list')) return;
    const violation = perfAloneViolation(suite.allTests().map((t) => t.parent.project()?.name));
    if (violation) {
      // An error thrown from a reporter is only logged and the run goes on, so this one stops the process itself,
      // before the first test starts: nothing has been measured next to anything else. The process ends here,
      // so the other reporters (HTML, blob, Allure) write nothing for this run. The refusal is therefore also written to the
      // output directory, which a CI job uploads, so a wrongly scheduled run leaves a named artefact and not only a console line.
      console.error(`\n${violation}`);
      recordRefusal(config.projects[0]?.outputDir, violation);
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
    const violation = skipRatioViolation(challenged, tests.length);
    if (!violation) return undefined;
    console.error(`\n${violation}`);
    return Promise.resolve({ status: 'failed' });
  }
}

/** A test of a setup project (`account-setup`, `admin-setup`): the sign-in other projects depend on, not a test of the shop. */
function isSetup(test: TestCase): boolean {
  return test.parent.project()?.name.endsWith('-setup') ?? false;
}

/** Leaves the refusal in `<outputDir>/run-guard-refused.txt`; a failure to write it must not hide the refusal itself. */
function recordRefusal(outputDir: string | undefined, violation: string): void {
  if (!outputDir) return;
  try {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'run-guard-refused.txt'), `${violation}\n`);
  } catch {
    // The console line above already says why the run was refused.
  }
}
