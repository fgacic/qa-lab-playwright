// Run by tests/framework/lint-config.spec.ts: lints each code sample read from stdin (a JSON array of strings) as a spec, with the
// hazard rules of eslint.config.mjs exactly as configured, and prints the messages as JSON (one array per sample).
// A node script, not an import of the spec: the config is ESM that Playwright's own loader would rewrite.
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import config from '../../../eslint.config.mjs';

const block = config.find((entry) => entry.files?.[0] === 'tests/**/*.spec.ts' && entry.rules?.['no-restricted-syntax']);
if (!block) throw new Error('the block of hazard rules is not in eslint.config.mjs');
const linter = new Linter({ configType: 'flat' });
const samples = JSON.parse(await new Promise((resolve) => {
  let input = '';
  process.stdin.on('data', (chunk) => (input += chunk)).on('end', () => resolve(input));
}));
const lintConfig = [{ files: ['**/*.ts'], languageOptions: { parser: tseslint.parser }, rules: { 'no-restricted-syntax': block.rules['no-restricted-syntax'] } }];
console.log(JSON.stringify(samples.map((code) => linter.verify(code, lintConfig, 'sample.spec.ts').map((m) => m.message.split(':')[0]))));
