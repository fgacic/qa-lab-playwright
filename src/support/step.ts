import { test } from '@playwright/test';

/**
 * Wraps a page-object method in `test.step`, so traces and reports read as a scenario
 * ("Search for 'pliers'") rather than a list of clicks. `{name}` placeholders are filled
 * from the method's arguments: `@step('Search for "{0}"')`, or `{0.email}` for a field.
 */
export function step(title?: string) {
  return function <This, Args extends unknown[], Return>(
    target: (this: This, ...args: Args) => Promise<Return>,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Promise<Return>>,
  ) {
    return function (this: This, ...args: Args): Promise<Return> {
      const name = title
        ? title.replace(/\{(\d+)(?:\.(\w+))?\}/g, (_, i, key) => {
            const arg = args[Number(i)] as Record<string, unknown> | undefined;
            return key ? format(arg?.[key], key) : format(arg);
          })
        : `${(this as object).constructor.name}.${String(context.name)}`;
      return test.step(name.trim(), () => target.apply(this, args), { box: true });
    };
  };
}

/** Keys whose values never reach a step title (and so never a trace, a report or a CI log). */
const SECRET_KEY = /pass|token|secret/i;
export const REDACTED = '[redacted]';

/** How a step argument reads in a title. Objects are written as JSON with the values of secret-looking keys replaced, at any depth. */
export function format(value: unknown, key?: string): string {
  if (key && SECRET_KEY.test(key)) return REDACTED;
  if (value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((item) => format(item)).join(', ');
  return JSON.stringify(value, (k, v: unknown) => (k && SECRET_KEY.test(k) ? REDACTED : v));
}
