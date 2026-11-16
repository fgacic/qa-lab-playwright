import { MAX_BOT_CHALLENGE_SKIP_RATIO } from './bot-challenge';

/** The message for a run that schedules the perf project next to others, or undefined when it is alone (or absent). */
export function perfAloneViolation(projects: Iterable<string | undefined>): string | undefined {
  const names = new Set(projects);
  if (!names.has('perf') || names.size < 2) return undefined;
  return (
    `The perf budgets must run alone, but this run also schedules ${[...names].filter((p) => p !== 'perf').join(', ')}. ` +
    'Run `npm run test:perf` (--project=perf) in its own pass.'
  );
}

/**
 * The projects a command line selects: the values of every `--project` (`--project=x` or `--project x`, repeatable), or every
 * configured project when there is none. Used by the config at load time, where no test has been scheduled yet.
 */
export function selectedProjects(argv: readonly string[], configured: readonly string[]): string[] {
  const named: string[] = [];
  argv.forEach((arg, i) => {
    if (arg.startsWith('--project=')) named.push(arg.slice('--project='.length));
    else if (arg === '--project' || arg === '-p') named.push(...(argv[i + 1]?.split(',') ?? []));
  });
  return named.length ? named.flatMap((n) => n.split(',')) : [...configured];
}

/** Whether a command line replaces the configured reporters, which switches the run-guard reporter (and so its skip-ratio check) off. */
export function overridesReporter(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === '--reporter' || arg.startsWith('--reporter='));
}

/** The failure message when more than `MAX_BOT_CHALLENGE_SKIP_RATIO` of the tests were skipped by the challenge, else undefined. */
export function skipRatioViolation(challenged: number, total: number): string | undefined {
  if (!total || challenged / total <= MAX_BOT_CHALLENGE_SKIP_RATIO) return undefined;
  return (
    `${challenged} of ${total} tests were skipped because Cloudflare challenged the run (more than ${MAX_BOT_CHALLENGE_SKIP_RATIO * 100}%): ` +
    'the run proves nothing about the shop, so it fails.'
  );
}
