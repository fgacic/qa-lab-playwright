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

/** Playwright's own reading of a `--project` value: case-insensitive, with `*` and `?` as wildcards, matched against the whole name. */
function projectMatcher(pattern: string): RegExp {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${source}$`, 'i');
}

/** The raw values of every `--project` / `-p` (`--project=x`, `--project x y`, comma lists, repeatable), in the order given. */
function projectPatterns(argv: readonly string[]): string[] {
  const named: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--project=')) named.push(arg.slice('--project='.length));
    else if (arg === '--project' || arg === '-p') {
      // The option is variadic: every following word up to the next flag is a project.
      while (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) named.push(argv[++i]);
    }
  }
  return named.flatMap((n) => n.split(',')).filter(Boolean);
}

/**
 * The configured projects a command line selects, read as Playwright reads `--project`: case-insensitively and with wildcards,
 * so `--project=PERF` and `--project=per*` select perf. With no `--project` every configured project is selected.
 * Used by the config at load time, where no test has been scheduled yet.
 */
export function selectedProjects(argv: readonly string[], configured: readonly string[]): string[] {
  const patterns = projectPatterns(argv);
  if (!patterns.length) return [...configured];
  const picked = new Set<string>();
  for (const pattern of patterns) {
    const matcher = projectMatcher(pattern);
    for (const name of configured) if (matcher.test(name)) picked.add(name);
  }
  return [...picked];
}

/** Whether the command line narrows the run to some tests (a path filter or a grep), so that "every configured project" is not "every project with tests". */
function filtersTests(argv: readonly string[]): boolean {
  const VALUE_FLAGS = new Set(['--project', '-p', '--grep', '-g', '--grep-invert', '--reporter', '--workers', '-j', '--retries', '--output', '--config', '-c', '--timeout', '--repeat-each', '--shard', '--max-failures', '--tag', '--trace', '--ui-host', '--ui-port']);
  const at = argv.indexOf('test');
  const rest = argv.slice(at >= 0 ? at + 1 : 2); // after `playwright test`, or after `node <script>` when the command word is absent
  const positional = rest.some((arg, i) => !arg.startsWith('-') && !(i > 0 && VALUE_FLAGS.has(rest[i - 1])));
  return positional || rest.some((arg) => /^(?:--grep|-g|--grep-invert|--tag)(?:=|$)/.test(arg));
}

/**
 * The perf rule for a command line that replaces the reporters (so the reporter's own check does not run): the violation when it
 * schedules perf next to other projects, else undefined. It throws only when perf is actually selected:
 * - `--project` names are read as Playwright reads them (`selectedProjects`), so a glob or another case cannot slip past;
 * - with no `--project` and no path or grep filter every project is scheduled, perf included;
 * - with no `--project` but a filter, which projects end up with tests cannot be known here, so a run is refused only when the
 *   filter itself names perf; it is told to pass `--project` (an exact name) instead of being guessed at.
 */
export function perfAloneViolationFor(argv: readonly string[], configured: readonly string[]): string | undefined {
  if (!configured.includes('perf')) return undefined;
  if (projectPatterns(argv).length) return perfAloneViolation(selectedProjects(argv, configured));
  if (!filtersTests(argv)) return perfAloneViolation(configured);
  if (/perf/i.test(argv.join(' '))) {
    return 'This run names perf in a filter but no --project, so which projects it schedules cannot be told. Pass --project=perf (the perf budgets run alone: `npm run test:perf`).';
  }
  return undefined;
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
