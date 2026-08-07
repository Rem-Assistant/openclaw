import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginTalkSpeech,
  cancelTalkSpeech,
  cancelTalkSpeechForConnection,
  finishTalkSpeech,
  resetTalkSpeechCancellationForTests,
} from "./talk-speech-cancellation.js";

describe("talk speech cancellation", () => {
  afterEach(() => {
    resetTalkSpeechCancellationForTests();
  });

  it("cancels an active preview once and is idempotent afterward", () => {
    const controller = beginTalkSpeech("conn-a", "preview-a");
    const listener = vi.fn();
    controller.signal.addEventListener("abort", listener);

    expect(cancelTalkSpeech("conn-a", "preview-a")).toBe(true);
    expect(cancelTalkSpeech("conn-a", "preview-a")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
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

  it("does not let an older request finish remove its replacement", () => {
    const older = beginTalkSpeech("conn-a", "preview-a");
    const newer = beginTalkSpeech("conn-a", "preview-a");
    finishTalkSpeech("conn-a", "preview-a", older);

    expect(older.signal.aborted).toBe(true);
    expect(cancelTalkSpeech("conn-a", "preview-a")).toBe(true);
    expect(newer.signal.aborted).toBe(true);
  });
});
