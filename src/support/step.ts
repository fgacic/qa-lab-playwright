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
            return format(key ? arg?.[key] : arg);
          })
        : `${(this as object).constructor.name}.${String(context.name)}`;
      return test.step(name, () => target.apply(this, args), { box: true });
    };
  };
}

function format(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(format).join(', ');
  return JSON.stringify(value);
}
