const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Pictographs, flags (regional indicator pairs) and keycaps such as 1️⃣. */
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

/**
 * The emoji at the start of a title, as one whole character (skin tones, flags and ZWJ
 * sequences included), or null if the title doesn't start with one.
 */
export function leadingEmoji(title: string): string | null {
  const first = graphemes.segment(title)[Symbol.iterator]().next();
  if (first.done) return null;
  return EMOJI.test(first.value.segment) ? first.value.segment : null;
}
