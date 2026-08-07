import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginTalkSpeech,
  cancelTalkSpeech,
  cancelTalkSpeechForConnection,
  finishTalkSpeech,
  resetTalkSpeechCancellationForTests,
  TALK_SPEECH_CANCEL_TOMBSTONE_LIMIT_PER_CONNECTION,
} from "./talk-speech-cancellation.js";

describe("talk speech cancellation", () => {
  afterEach(() => {
    resetTalkSpeechCancellationForTests();
  });

  it("cancels an active preview once and accepts repeated cancellation idempotently", () => {
    const controller = beginTalkSpeech("conn-a", "preview-a");
    const listener = vi.fn();
    controller.signal.addEventListener("abort", listener);

    expect(cancelTalkSpeech("conn-a", "preview-a")).toBe(true);
    expect(cancelTalkSpeech("conn-a", "preview-a")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("consumes a reversed-order cancel tombstone before synthesis can begin", () => {
    expect(cancelTalkSpeech("conn-a", "preview-a")).toBe(true);

    const controller = beginTalkSpeech("conn-a", "preview-a");

    expect(controller.signal.aborted).toBe(true);
  });

  it("expires bounded cancel tombstones", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T00:00:00Z"));
    expect(cancelTalkSpeech("conn-a", "preview-a")).toBe(true);
    vi.advanceTimersByTime(30_001);

    const controller = beginTalkSpeech("conn-a", "preview-a");

    expect(controller.signal.aborted).toBe(false);
    vi.useRealTimers();
  });

  it("fails closed when one connection exceeds its bounded tombstone capacity", () => {
    for (let index = 0; index <= TALK_SPEECH_CANCEL_TOMBSTONE_LIMIT_PER_CONNECTION; index += 1) {
      expect(cancelTalkSpeech("conn-a", `preview-${index}`)).toBe(true);
    }

    expect(beginTalkSpeech("conn-a", "never-seen-before").signal.aborted).toBe(true);
    expect(beginTalkSpeech("conn-b", "never-seen-before").signal.aborted).toBe(false);
  });

  it("recovers a saturated connection after expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T00:00:00Z"));
    for (let index = 0; index <= TALK_SPEECH_CANCEL_TOMBSTONE_LIMIT_PER_CONNECTION; index += 1) {
      cancelTalkSpeech("conn-a", `preview-${index}`);
    }
    vi.advanceTimersByTime(30_001);

    expect(beginTalkSpeech("conn-a", "after-expiry").signal.aborted).toBe(false);
    vi.useRealTimers();
  });

  it("scopes identical preview ids to their owning connection", () => {
    const owned = beginTalkSpeech("conn-a", "shared-preview");
    const other = beginTalkSpeech("conn-b", "shared-preview");

    expect(cancelTalkSpeech("conn-a", "shared-preview")).toBe(true);
    expect(owned.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
  });

  it("cancels every preview owned by a disconnected client only", () => {
    const first = beginTalkSpeech("conn-a", "preview-a");
    const second = beginTalkSpeech("conn-a", "preview-b");
    const other = beginTalkSpeech("conn-b", "preview-c");

    expect(cancelTalkSpeechForConnection("conn-a")).toBe(2);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
  });

  it("clears pending tombstones when their owning connection disconnects", () => {
    expect(cancelTalkSpeech("conn-a", "preview-a")).toBe(true);
    expect(cancelTalkSpeechForConnection("conn-a")).toBe(0);

    const controller = beginTalkSpeech("conn-a", "preview-a");

    expect(controller.signal.aborted).toBe(false);
  });

  it("does not let an older request finish remove its replacement", () => {
    const older = beginTalkSpeech("conn-a", "preview-a");
    const newer = beginTalkSpeech("conn-a", "preview-a");
    finishTalkSpeech("conn-a", "preview-a", older);

    expect(older.signal.aborted).toBe(true);
    expect(cancelTalkSpeech("conn-a", "preview-a")).toBe(true);
    expect(newer.signal.aborted).toBe(true);
  });
});
