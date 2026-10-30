/**
 * Pitch and scale, as pure arithmetic.
 *
 * Nothing here touches Web Audio, so all of it runs in Node and can be asserted
 * rather than listened to. That matters because a wrong frequency is not an
 * error — it is a different note, and it plays perfectly happily.
 */

/** Chromatic note names, sharps only. */
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Equal-tempered Hz for a MIDI note, A4 = 440. */
export function noteToFrequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** 60 as "C4". Negative and out-of-range octaves stay spelled correctly. */
export function noteLabel(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export interface ScaleDescriptor {
  id: string;
  label: string;
  /** Semitone offsets within one octave. */
  degrees: number[];
}

/**
 * A registry rather than a union, so adding a scale is one entry and every
 * reader — a keyboard that constrains input, a generator that picks notes —
 * sees it without being edited.
 */
export const SCALES: Record<string, ScaleDescriptor> = {
  dorian: { id: "dorian", label: "Dorian", degrees: [0, 2, 3, 5, 7, 9, 10] },
  aeolian: { id: "aeolian", label: "Aeolian (natural minor)", degrees: [0, 2, 3, 5, 7, 8, 10] },
  pentatonic: { id: "pentatonic", label: "Minor pentatonic", degrees: [0, 3, 5, 7, 10] },
  "major-pentatonic": {
    id: "major-pentatonic",
    label: "Major pentatonic",
    degrees: [0, 2, 4, 7, 9],
  },
  lydian: { id: "lydian", label: "Lydian", degrees: [0, 2, 4, 6, 7, 9, 11] },
};
