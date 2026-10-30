/**
 * The public surface of the starter.
 *
 * Everything re-exported here is the whole API. Two kinds of thing live behind
 * it: pure arithmetic that runs anywhere and can be asserted, and builders that
 * need a `BaseAudioContext` and therefore a browser. The modules are kept
 * separate on purpose so the arithmetic can be tested in Node without a DOM.
 */

export * from "./pitch.ts";
export * from "./unison.ts";
export * from "./amplitude.ts";
export * from "./slew.ts";
export * from "./effects.ts";
export * from "./sample.ts";
