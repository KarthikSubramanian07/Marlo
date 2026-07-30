import type { Edit } from '@marlo/schema';

/**
 * Applying edits to text.
 *
 * Three properties, and each one is a defect somebody has shipped before.
 *
 * **Every edit verifies the bytes it is replacing.** `Edit.before` is what the range currently
 * holds, the schema already requires `before.length === end - start`, and this checks the file
 * actually contains it. An edit computed against one version of a file and applied to another
 * is how a codemod deletes something at random, and it is silent when the offsets happen to be
 * in range.
 *
 * **Overlapping edits are refused, not merged.** Two edits touching the same bytes mean two
 * rules disagree about the same construct, and the answer to that is a human, not a
 * last-writer-wins.
 *
 * **Applied back to front.** Applying forwards invalidates every later offset, which is the
 * classic version of this bug and produces edits that land a few characters off.
 */

export class EditConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditConflictError';
  }
}

/** Sorted back to front, so applying one cannot move the next. */
function ordered(edits: readonly Edit[]): readonly Edit[] {
  return [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
}

/** Two edits touching the same bytes. A zero-width insert at the same point counts. */
export function conflicts(edits: readonly Edit[]): readonly [Edit, Edit][] {
  const found: [Edit, Edit][] = [];
  const byPosition = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < byPosition.length; i += 1) {
    const previous = byPosition[i - 1];
    const current = byPosition[i];
    if (previous === undefined || current === undefined) continue;
    if (previous.file !== current.file) continue;
    const overlaps =
      current.start < previous.end ||
      (current.start === previous.start && current.end === previous.end);
    if (overlaps) found.push([previous, current]);
  }
  return found;
}

export function applyEdits(source: string, edits: readonly Edit[]): string {
  const clashes = conflicts(edits);
  if (clashes.length > 0) {
    const [first, second] = clashes[0] ?? [];
    throw new EditConflictError(
      `two edits touch the same bytes in ${first?.file ?? 'the file'} at ` +
        `${String(first?.start ?? 0)}..${String(first?.end ?? 0)} and ` +
        `${String(second?.start ?? 0)}..${String(second?.end ?? 0)}. Two rules disagree about ` +
        'the same construct, which is a decision for a person.',
    );
  }

  let out = source;
  for (const edit of ordered(edits)) {
    const actual = out.slice(edit.start, edit.end);
    if (actual !== edit.before) {
      throw new EditConflictError(
        `${edit.file} does not contain what this edit expected at ${String(edit.start)}..` +
          `${String(edit.end)}. Expected ${JSON.stringify(edit.before)}, found ` +
          `${JSON.stringify(actual)}. The file changed after the edit was computed.`,
      );
    }
    out = out.slice(0, edit.start) + edit.after + out.slice(edit.end);
  }
  return out;
}

/**
 * Whether applying the same edits twice produces the same text as applying them once.
 *
 * `Verification.idempotent` is a field the schema has always had, and this is what fills it in.
 * The check is deliberately literal: recompute the edits against the repaired text and confirm
 * there are none left. A codemod that keeps finding work on its own output is a codemod that
 * would run forever in a pre-commit hook.
 */
export function isIdempotent(
  source: string,
  edits: readonly Edit[],
  recompute: (text: string) => readonly Edit[],
): boolean {
  const once = applyEdits(source, edits);
  const again = recompute(once);
  if (again.length === 0) return true;
  return applyEdits(once, again) === once;
}
