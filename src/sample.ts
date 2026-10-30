/**
 * Audio-file handling: decode, downmix, re-encode, and describe what came out.
 *
 * Browsers decode almost any container, but almost nothing downstream wants a
 * decoded buffer in its original shape. So every file goes through the same
 * funnel: decode with Web Audio, downmix to mono, and hand on both the samples
 * and a 16-bit PCM WAV encoding of them. The decoded buffer also yields the
 * waveform peaks and the file's own numbers for free.
 *
 * The WAV encoder is here rather than left to a dependency because it is twelve
 * lines of header and a clamp, and because a buffer that has already been
 * decoded once should never have to be decoded again to be written out.
 */

export interface PeakBucket {
  min: number;
  max: number;
}

export interface DecodedSample {
  name: string;
  byteSize: number;
  duration: number;
  sampleRate: number;
  channels: number;
  /** Decoded, downmixed samples — what a waveform drawing reads. */
  mono: Float32Array;
  /** 16-bit PCM mono WAV bytes — what a consumer that wants a file reads. */
  wav: Uint8Array;
  peaks: PeakBucket[];
}

/** Peak buckets computed per sample; a canvas resamples these to its width. */
export const PEAK_BUCKETS = 1200;

/**
 * Encode samples as a 16-bit PCM mono WAV file.
 *
 * Values are clamped on the way in, because a sample past full scale wraps
 * rather than saturating and the result is a loud click with nothing to explain
 * it.
 */
export function encodeWavMono(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

/**
 * Min and max per bucket, for drawing a waveform at any width.
 *
 * Peaks rather than every sample, because a canvas a thousand pixels wide cannot
 * show a million frames and picking one frame per pixel loses the transients —
 * which is exactly what a waveform is looked at for.
 */
export function computePeaks(samples: Float32Array, buckets: number): PeakBucket[] {
  const peaks: PeakBucket[] = [];
  if (samples.length === 0 || buckets <= 0) return peaks;

  const perBucket = Math.max(1, Math.floor(samples.length / buckets));
  for (let b = 0; b < buckets; b++) {
    const start = b * perBucket;
    const end = Math.min(samples.length, start + perBucket);
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    peaks.push({ min, max });
  }
  return peaks;
}

/** Equal-weight downmix. A mono buffer is copied through unchanged. */
export function downmixToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const out = new Float32Array(buffer.length);
  if (channels <= 1) {
    if (channels === 1) out.set(buffer.getChannelData(0));
    return out;
  }

  const weight = 1 / channels;
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += data[i] * weight;
  }
  return out;
}

function finalize(name: string, byteSize: number, buffer: AudioBuffer, mono: Float32Array): DecodedSample {
  return {
    name,
    byteSize,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    mono,
    wav: encodeWavMono(mono, buffer.sampleRate),
    peaks: computePeaks(mono, PEAK_BUCKETS),
  };
}

/** Decode a user-picked file. Throws if the browser cannot decode the container. */
export async function decodeSampleFile(file: File, ctx: BaseAudioContext): Promise<DecodedSample> {
  const raw = await file.arrayBuffer();
  // Decoding detaches the buffer it is given, so hand it a copy and keep the
  // original for anything that still wants the bytes.
  const buffer = await ctx.decodeAudioData(raw.slice(0));
  return finalize(file.name, file.size, buffer, downmixToMono(buffer));
}

/**
 * A procedurally generated pluck sequence.
 *
 * So a starter is audible the moment it runs, with no binary asset in the repo
 * to license, to lose or to fail to load. Four notes, each a handful of
 * inharmonic partials with a short noise transient, normalised to just under
 * full scale.
 */
export function createDemoSample(ctx: BaseAudioContext): DecodedSample {
  const sampleRate = ctx.sampleRate;
  const total = Math.floor(sampleRate * 2.2);
  const mono = new Float32Array(total);

  const notes = [
    { at: 0.0, freq: 196.0 },
    { at: 0.45, freq: 261.63 },
    { at: 0.9, freq: 233.08 },
    { at: 1.35, freq: 293.66 },
  ];

  const partials = [
    { ratio: 1.0, amp: 1.0, decay: 3.2 },
    { ratio: 2.01, amp: 0.4, decay: 5.0 },
    { ratio: 3.02, amp: 0.18, decay: 7.5 },
    { ratio: 5.4, amp: 0.07, decay: 11.0 },
  ];

  for (const note of notes) {
    const start = Math.floor(note.at * sampleRate);
    for (let i = start; i < total; i++) {
      const t = (i - start) / sampleRate;
      if (t > 0.85) break;

      let v = 0;
      for (const p of partials) {
        v += p.amp * Math.exp(-t * p.decay) * Math.sin(2 * Math.PI * note.freq * p.ratio * t);
      }
      // A short noise transient, so a filter and a modulation have something to
      // bite on instead of shaping a pure tone.
      if (t < 0.015) v += (Math.random() * 2 - 1) * 0.45 * (1 - t / 0.015);

      mono[i] += v * 0.32 * Math.exp(-t * 0.4);
    }
  }

  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(mono[i]));
  if (peak > 0) {
    const scale = 0.9 / peak;
    for (let i = 0; i < total; i++) mono[i] *= scale;
  }

  const wav = encodeWavMono(mono, sampleRate);
  return {
    name: "demo-pluck.wav (generated)",
    byteSize: wav.byteLength,
    duration: total / sampleRate,
    sampleRate,
    channels: 1,
    mono,
    wav,
    peaks: computePeaks(mono, PEAK_BUCKETS),
  };
}
