import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isCanonicalTalkMp3 } from "./talk-mp3-validation.js";

const fixture = readFileSync(
  fileURLToPath(new URL("../../test/fixtures/talk-canonical.mp3", import.meta.url)),
);

describe("canonical Talk MP3 validation", () => {
  it("accepts the real FFmpeg-encoded, FFprobe-decodable fixture", () => {
    expect(isCanonicalTalkMp3(fixture)).toBe(true);
  });

  it.each([
    ["ID3-only", Buffer.from("ID3canonical-mp3")],
    ["bogus sync", Buffer.from([0xff, 0xfb, 0, 0, 0, 0, 0, 0])],
    ["truncated frame", fixture.subarray(0, 100)],
    ["WAV", Buffer.from("RIFFgoogle-wav-fixture")],
    ["generic PCM", Buffer.alloc(512)],
  ])("rejects %s audio", (_name, audio) => {
    expect(isCanonicalTalkMp3(audio)).toBe(false);
  });
});
