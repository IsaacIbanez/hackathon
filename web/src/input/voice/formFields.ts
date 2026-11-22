// Finding the fields of a form in the document's text blocks, and writing values into them.
// Pure logic: works on the contract's TextBlock shape ({id, text, box}).

export interface BlockLike {
  id: string;
  text: string;
  box: { x: number; y: number; w: number; h: number };
}

export interface FormField {
  /** Id of the block that holds the field. */
  id: string;
  /** What the field asks for ("Nombre y apellidos"). */
  label: string;
  box: BlockLike["box"];
}

/** Blank to fill in: underscores, dots or a date mask like __/__/____. */
const BLANK = /(?:_{2,}|\.{4,}|…{2,})(?:[\s/.-]*(?:_{2,}|\.{4,}))*/;

/** Blocks that are fields: they have a blank, or are a short label ending with a colon. */
export function findFields(blocks: readonly BlockLike[]): FormField[] {
  const fields: FormField[] = [];
  for (const b of [...blocks].sort((a, c) => a.box.y - c.box.y || a.box.x - c.box.x)) {
    const text = b.text.trim();
    const hasBlank = BLANK.test(text);
    const isLabel = /:\s*$/.test(text) && text.length <= 60;
    if (!hasBlank && !isLabel) continue;
    const label = text.replace(BLANK, "").replace(/[:\s]+$/, "").trim();
    if (label) fields.push({ id: b.id, label, box: b.box });
  }
  return fields;
}

/** The field under a point on the document (with a small margin), or null. */
export function fieldAt(fields: readonly FormField[], p: { x: number; y: number } | null, margin = 0.03): FormField | null {
  if (!p) return null;
  let best: FormField | null = null;
  let bestDistance = Infinity;
  for (const f of fields) {
    const { x, y, w, h } = f.box;
    if (p.x < x - margin || p.x > x + w + margin || p.y < y - margin || p.y > y + h + margin) continue;
    const d = Math.hypot(p.x - (x + w / 2), p.y - (y + h / 2));
    if (d < bestDistance) [best, bestDistance] = [f, d];
  }
  return best;
}

/** First field without a value, starting after `afterId` (wraps around). */
export function nextEmptyField(
  fields: readonly FormField[],
  values: Readonly<Record<string, string>>,
  afterId: string | null = null,
): FormField | null {
  const start = afterId ? fields.findIndex((f) => f.id === afterId) + 1 : 0;
  for (let k = 0; k < fields.length; k++) {
    const f = fields[(start + k) % fields.length];
    if (!values[f.id]) return f;
  }
  return null;
}

/** The block's text with the value written in its blank (or after its colon). */
export function writeValue(text: string, value: string): string {
  if (BLANK.test(text)) return text.replace(BLANK, value);
  return `${text.replace(/\s+$/, "")} ${value}`;
}
