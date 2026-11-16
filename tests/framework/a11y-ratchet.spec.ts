// The a11y ratchet's decision (src/support/a11y-baseline.ts `diffFindings`): what counts as new, spread, shrank, changed or fixed.
// No browser: it is a pure function, so every branch is a row of a table.
import { expect, test } from '@playwright/test';
import { diffFindings, type KnownViolation, type ScanFinding } from '../../src/support/a11y-baseline';

const entry = (over: Partial<KnownViolation> = {}): KnownViolation => ({
  id: 'AX-01', rule: 'list', impact: 'serious', wcag: '1.3.1', target: '.checkbox > ul', nodes: 3, page: 'home', pages: ['home', 'cart'], summary: 'a defect', ...over,
});
const finding = (over: Partial<ScanFinding> = {}): ScanFinding => ({ rule: 'list', target: '.checkbox > ul', impact: 'serious', nodes: 3, ...over });

interface Row {
  name: string;
  known: KnownViolation[];
  findings: ScanFinding[];
  scan?: 'home' | 'cart' | 'product';
  selfHosted?: boolean;
  problems: (string | RegExp)[];
  fixed: (string | RegExp)[];
}

const ROWS: Row[] = [
  { name: 'a known violation as recorded is neither new nor fixed', known: [entry()], findings: [finding()], problems: [], fixed: [] },
  { name: 'an unknown rule is new', known: [entry()], findings: [finding(), finding({ rule: 'button-name', target: '.btn', impact: 'critical' })], problems: ['button-name (critical) on .btn'], fixed: [] },
  { name: 'a known rule on another target is new', known: [entry()], findings: [finding(), finding({ target: '.other > ul' })], problems: ['list (serious) on .other > ul'], fixed: [] },
  { name: 'a known violation on a scan it was not recorded on is new', known: [entry()], findings: [finding()], scan: 'product', problems: ['list (serious) on .checkbox > ul'], fixed: [] },
  { name: 'more elements than recorded is a spread', known: [entry()], findings: [finding({ nodes: 4 })], problems: [/AX-01 spreads: .* now hits 4 elements, known for 3/], fixed: [] },
  { name: 'fewer elements than recorded is a partial fix', known: [entry()], findings: [finding({ nodes: 2 })], problems: [/AX-01 shrank: .* now hits 2 elements, known for 3/], fixed: [] },
  { name: 'a different impact is a change of kind, whatever the count', known: [entry()], findings: [finding({ impact: 'critical', nodes: 9 })], problems: [/AX-01 changed impact: .* now critical, known as serious/], fixed: [] },
  { name: 'a known violation gone from a scan it was recorded on is fixed there', known: [entry()], findings: [], problems: [], fixed: [/AX-01 fixed here: list on \.checkbox > ul is gone from home/] },
  { name: 'a known violation absent from a scan it was never recorded on is not fixed there', known: [entry()], findings: [], scan: 'product', problems: [], fixed: [] },
  { name: 'a seed-dependent count is held exactly on the self-hosted shop', known: [entry({ seedDependent: true })], findings: [finding({ nodes: 5 })], selfHosted: true, problems: [/spreads/], fixed: [] },
  { name: 'a seed-dependent count is not held elsewhere', known: [entry({ seedDependent: true })], findings: [finding({ nodes: 5 })], selfHosted: false, problems: [], fixed: [] },
  { name: 'a seed-dependent violation elsewhere still has to be found, and its impact still holds', known: [entry({ seedDependent: true })], findings: [finding({ impact: 'minor' })], selfHosted: false, problems: [/changed impact/], fixed: [] },
  { name: 'a seed-dependent violation that is gone is fixed on every target', known: [entry({ seedDependent: true })], findings: [], selfHosted: false, problems: [], fixed: [/AX-01 fixed here/] },
];

test.describe('the a11y ratchet', { tag: ['@framework'] }, () => {
  for (const row of ROWS) {
    test(row.name, () => {
      const diff = diffFindings(row.known, row.findings, row.scan ?? 'home', { selfHosted: row.selfHosted ?? true });
      const shape = (expected: (string | RegExp)[]) => expected.map((e) => (typeof e === 'string' ? e : expect.stringMatching(e)));
      expect(diff.problems).toEqual(shape(row.problems));
      expect(diff.fixed).toEqual(shape(row.fixed));
    });
  }
});
