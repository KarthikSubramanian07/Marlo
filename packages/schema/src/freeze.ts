/**
 * Typed deep-freeze helpers.
 *
 * These exist because `Object.freeze(['dom', 'script'])` widens to `string[]`, and
 * the usual repair is `as const`, which ESLint forbids in this package: the rule is
 * `consistent-type-assertions: never`, on the grounds that a trust boundary casting
 * instead of parsing is the failure Zod is here to prevent. That rule is worth more
 * than the convenience of an assertion, so the widening is fixed with a generic
 * instead.
 */

/** A frozen list whose element type is stated rather than inferred as `string`. */
export function frozenList<T>(...items: readonly T[]): readonly T[] {
  return Object.freeze([...items]);
}

/** A frozen record, with the key and value types preserved. */
export function frozenRecord<K extends string, V>(record: Record<K, V>): Readonly<Record<K, V>> {
  return Object.freeze({ ...record });
}
