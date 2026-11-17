/**
 * Resolves when any of `reactions` (each a promise that rejects when its window runs out) comes true, and rejects when none
 * does (the test asserts it with `expect(...).resolves`, so the failure is an assertion that carries the expectation). Every one is observed from the moment it is passed in,
 * so the ones that lose the race, or all of them when the action throws, never end as an unhandled rejection. Call it
 * before the action, await the result after.
 */
export function reactionWithin(...reactions: Promise<unknown>[]): Promise<void> {
  const ignore = () => undefined;
  for (const reaction of reactions) reaction.catch(ignore);
  const reacted = Promise.any(reactions).then(ignore, () => Promise.reject(new Error('no reaction within its window')));
  reacted.catch(ignore);
  return reacted;
}
