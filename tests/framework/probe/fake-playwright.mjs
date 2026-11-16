// A stand-in for `playwright test` that scripts/verify-bugs.mjs runs under tests/framework/verify-bugs.spec.ts
// (VERIFY_BUGS_PLAYWRIGHT). It answers from the scenario file in FAKE_PLAYWRIGHT_SCENARIO and appends every call to its log.
//
// scenario = { pins: [{ file, line, title, id, projects, onLive?: true, runs: [outcome, ...] }] }
// An outcome is 'reproduces' | 'fixed' | 'other' (a failure that does not name the id); the nth run of a pin takes the nth outcome
// (the last repeats), so [other, reproduces] is a pin that fails for another reason and then reproduces on its rerun.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const scenario = JSON.parse(readFileSync(process.env.FAKE_PLAYWRIGHT_SCENARIO, 'utf8'));
const out = process.env.PLAYWRIGHT_JSON_OUTPUT_NAME;
const live = process.env.TARGET === 'live';
const listing = args.includes('--list');
const projects = args.filter((a) => a.startsWith('--project=')).map((a) => a.slice('--project='.length));
const rerun = args.includes('--workers=1');
const grep = args[args.indexOf('--grep') + 1];

appendFileSync(process.env.FAKE_PLAYWRIGHT_LOG, `${JSON.stringify({ listing, live, projects, rerun, env: { VERIFY_BUGS: process.env.VERIFY_BUGS } })}\n`);

// Counted across processes (each call of verify-bugs is a new one), in a file next to the log.
const countsFile = `${process.env.FAKE_PLAYWRIGHT_LOG}.counts`;
const counts = new Map(existsSync(countsFile) ? Object.entries(JSON.parse(readFileSync(countsFile, 'utf8'))) : []);
const specs = [];
for (const pin of scenario.pins) {
  if (!live && pin.onLive) continue; // scheduled only on the live target
  const here = listing ? pin.projects : pin.projects.filter((p) => projects.includes(p));
  if (!here.length) continue;
  if (rerun && !new RegExp(grep).test(pin.title)) continue;
  const tests = here.map((projectName) => {
    if (listing) return { projectName, status: 'skipped', annotations: [], results: [] };
    const n = counts.get(pin.title) ?? 0;
    counts.set(pin.title, n + 1);
    const outcome = pin.runs[Math.min(n, pin.runs.length - 1)];
    const location = { file: `/repo/${pin.file}` };
    const assertion = (text) => ({ message: `Error: ${text}\n\nexpect(received).toBe(expected)`, location });
    const annotations = [{ type: 'known bug', description: `${pin.id}: a defect` }];
    if (outcome === 'fixed') return { projectName, status: 'passed', annotations, results: [{ status: 'passed', errors: [] }] };
    const message = outcome === 'reproduces' ? `${pin.id}: wrong` : 'a precondition failed';
    return { projectName, status: 'unexpected', annotations, results: [{ status: 'failed', errors: [assertion(message)] }] };
  });
  specs.push({ file: pin.file, line: pin.line, title: pin.title, tags: ['bug'], tests });
}
writeFileSync(countsFile, JSON.stringify(Object.fromEntries(counts)));
writeFileSync(out, JSON.stringify({ suites: [{ specs }], errors: [] }));
process.exit(listing ? 0 : 1);
