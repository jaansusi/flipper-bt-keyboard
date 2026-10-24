// Live typing from a phone's on-screen keyboard (SPEC §7.4.1).
//
// On-screen keyboards report characters, not physical keys, and often edit
// whole words at once (autocorrect, suggestions, Android composition). So the
// field's value is compared before and after every change: removed characters
// become Backspace, added characters are typed with the selected layout.

// Invisible padding, so Backspace always has something to delete (and fires an
// input event) even when nothing visible is left in the field.
export const PADDING = "​".repeat(8);

/**
 * Difference between two field values, assuming edits happen at the end.
 * @returns {{ deleteCount: number, insert: string }} deleteCount in characters
 */
export function diffText(previous, next) {
  let common = 0;
  while (common < previous.length && common < next.length && previous[common] === next[common]) {
    common++;
  }
  return {
    deleteCount: [...previous.slice(common)].length,
    insert: next.slice(common),
  };
}

/**
 * @param {HTMLInputElement} field
 * @param {{
 *   onText: (text: string) => void,
 *   onBackspace: (count: number) => void,
 *   onEnter: () => void,
 * }} handlers
 */
export function attachTextInput(field, { onText, onBackspace, onEnter }) {
  let previous = PADDING;
  let composing = false;

  const reset = () => {
    field.value = PADDING;
    previous = PADDING;
    field.setSelectionRange(PADDING.length, PADDING.length);
  };

  const process = () => {
    const next = field.value;
    const { deleteCount, insert } = diffText(previous, next);
    previous = next;
    if (deleteCount > 0) onBackspace(deleteCount);
    if (insert) onText(insert);
    // Resetting during composition would break the keyboard's word editing
    if (!composing) reset();
  };

  field.addEventListener("focus", reset);
  field.addEventListener("input", process);
  field.addEventListener("compositionstart", () => (composing = true));
  field.addEventListener("compositionend", () => {
    composing = false;
    process();
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onEnter();
    }
  });
  // Keep the cursor at the end, where diffText expects edits
  field.addEventListener("click", () => field.setSelectionRange(field.value.length, field.value.length));

  reset();
}
