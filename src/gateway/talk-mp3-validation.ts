const MAX_ID3V2_TAG_BYTES = 256 * 1024;

type MpegVersion = "1" | "2" | "2.5";

type Mp3Frame = {
  length: number;
  version: MpegVersion;
  sampleRate: number;
};

function id3v2AudioOffset(audio: Buffer): number | undefined {
  if (audio.length < 3 || audio.subarray(0, 3).toString("ascii") !== "ID3") {
    return 0;
  }
  if (audio.length < 10) {
    return undefined;
  }
  const sizeBytes = [audio[6], audio[7], audio[8], audio[9]];
  if (sizeBytes.some((value) => value == null || (value & 0x80) !== 0)) {
    return undefined;
  }
  const tagSize = sizeBytes.reduce((size, value) => (size << 7) | (value ?? 0), 0);
  const audioOffset = 10 + tagSize;
  if (audioOffset > MAX_ID3V2_TAG_BYTES || audioOffset > audio.length) {
    return undefined;
  }
  return audioOffset;
}

function parseLayer3Frame(audio: Buffer, offset: number): Mp3Frame | undefined {
  if (offset < 0 || offset + 4 > audio.length) {
    return undefined;
  }
  const header = audio.readUInt32BE(offset);
  if (header >>> 21 !== 0x7ff) {
    return undefined;
  }

  const versionBits = (header >>> 19) & 0x3;
  const version: MpegVersion | undefined =
    versionBits === 0x3 ? "1" : versionBits === 0x2 ? "2" : versionBits === 0x0 ? "2.5" : undefined;
  const layerBits = (header >>> 17) & 0x3;
  if (!version || layerBits !== 0x1) {
    return undefined;
  }

  const bitrateIndex = (header >>> 12) & 0xf;
  const sampleRateIndex = (header >>> 10) & 0x3;
  if (bitrateIndex === 0 || bitrateIndex === 0xf || sampleRateIndex === 0x3) {
    return undefined;
  }

  const mpeg1Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const mpeg2Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const baseSampleRates = [44_100, 48_000, 32_000];
  const bitrateKbps = (version === "1" ? mpeg1Bitrates : mpeg2Bitrates)[bitrateIndex];
  const baseSampleRate = baseSampleRates[sampleRateIndex];
  if (!bitrateKbps || !baseSampleRate) {
    return undefined;
  }
  const sampleRate =
    version === "1" ? baseSampleRate : version === "2" ? baseSampleRate / 2 : baseSampleRate / 4;
  const padding = (header >>> 9) & 0x1;
  const coefficient = version === "1" ? 144 : 72;
  const frameLength = Math.floor((coefficient * bitrateKbps * 1000) / sampleRate) + padding;
  if (frameLength < 4 || offset + frameLength > audio.length) {
    return undefined;
  }
  return { length: frameLength, version, sampleRate };
}

/**
 * Validates the bounded prefix needed to certify buffered Talk audio as MP3.
 *
 * An optional ID3v2 tag is parsed with synchsafe length checks, then two complete,
 * consecutive MPEG Layer III frames are required. This intentionally rejects an
 * ID3 marker, a sync-shaped prefix, or a single truncated frame.
 */
export function isCanonicalTalkMp3(audio: Buffer): boolean {
  const firstOffset = id3v2AudioOffset(audio);
  if (firstOffset == null) {
    return false;
  }
  const first = parseLayer3Frame(audio, firstOffset);
  if (!first) {
    return false;
  }
  const second = parseLayer3Frame(audio, firstOffset + first.length);
  return Boolean(
    second && second.version === first.version && second.sampleRate === first.sampleRate,
  );
}
