type TalkSpeechCancellationEntry = {
  connectionId: string;
  previewId: string;
  controller: AbortController;
};

type TalkSpeechCancellationTombstone = {
  connectionId: string;
  expiresAt: number;
};

const activeTalkSpeech = new Map<string, TalkSpeechCancellationEntry>();
const cancelledTalkSpeech = new Map<string, TalkSpeechCancellationTombstone>();
const saturatedTalkSpeechConnections = new Map<string, number>();
const TALK_SPEECH_CANCEL_TOMBSTONE_TTL_MS = 30_000;
export const TALK_SPEECH_CANCEL_TOMBSTONE_LIMIT_PER_CONNECTION = 128;

function key(connectionId: string, previewId: string): string {
  return `${connectionId}\u0000${previewId}`;
}

export function beginTalkSpeech(connectionId: string, previewId: string): AbortController {
  pruneExpiredTalkSpeechTombstones();
  const entryKey = key(connectionId, previewId);
  activeTalkSpeech.get(entryKey)?.controller.abort();
  const controller = new AbortController();
  if (saturatedTalkSpeechConnections.has(connectionId)) {
    controller.abort();
    return controller;
  }
  if (cancelledTalkSpeech.delete(entryKey)) {
    controller.abort();
    return controller;
  }
  activeTalkSpeech.set(entryKey, { connectionId, previewId, controller });
  return controller;
}

export function finishTalkSpeech(
  connectionId: string,
  previewId: string,
  controller: AbortController,
): void {
  const entryKey = key(connectionId, previewId);
  if (activeTalkSpeech.get(entryKey)?.controller === controller) {
    activeTalkSpeech.delete(entryKey);
  }
}

export function cancelTalkSpeech(connectionId: string, previewId: string): boolean {
  pruneExpiredTalkSpeechTombstones();
  const entryKey = key(connectionId, previewId);
  const entry = activeTalkSpeech.get(entryKey);
  recordTalkSpeechTombstone(connectionId, entryKey);
  if (entry) {
    activeTalkSpeech.delete(entryKey);
    entry.controller.abort();
  }
  // Cancellation is idempotently accepted even when begin has not registered
  // yet. The bounded tombstone makes that reversed delivery order safe.
  return true;
}

export function cancelTalkSpeechForConnection(connectionId: string): number {
  pruneExpiredTalkSpeechTombstones();
  let cancelled = 0;
  for (const [entryKey, entry] of activeTalkSpeech) {
    if (entry.connectionId !== connectionId) {
      continue;
    }
    activeTalkSpeech.delete(entryKey);
    entry.controller.abort();
    cancelled += 1;
  }
  for (const [entryKey, tombstone] of cancelledTalkSpeech) {
    if (tombstone.connectionId === connectionId) {
      cancelledTalkSpeech.delete(entryKey);
    }
  }
  saturatedTalkSpeechConnections.delete(connectionId);
  return cancelled;
}

function recordTalkSpeechTombstone(connectionId: string, entryKey: string): void {
  const expiresAt = Date.now() + TALK_SPEECH_CANCEL_TOMBSTONE_TTL_MS;
  if (saturatedTalkSpeechConnections.has(connectionId)) {
    saturatedTalkSpeechConnections.set(connectionId, expiresAt);
    return;
  }
  if (cancelledTalkSpeech.has(entryKey)) {
    cancelledTalkSpeech.set(entryKey, { connectionId, expiresAt });
    return;
  }
  let connectionTombstones = 0;
  for (const tombstone of cancelledTalkSpeech.values()) {
    if (tombstone.connectionId === connectionId) {
      connectionTombstones += 1;
    }
  }
  if (connectionTombstones >= TALK_SPEECH_CANCEL_TOMBSTONE_LIMIT_PER_CONNECTION) {
    // Fail closed for the remainder of the bounded window. Removing the
    // per-id entries keeps memory bounded without allowing any later begin to
    // escape an unexpired cancellation.
    for (const [candidateKey, tombstone] of cancelledTalkSpeech) {
      if (tombstone.connectionId === connectionId) {
        cancelledTalkSpeech.delete(candidateKey);
      }
    }
    saturatedTalkSpeechConnections.set(connectionId, expiresAt);
    return;
  }
  cancelledTalkSpeech.set(entryKey, { connectionId, expiresAt });
}

function pruneExpiredTalkSpeechTombstones(now = Date.now()): void {
  for (const [entryKey, tombstone] of cancelledTalkSpeech) {
    if (tombstone.expiresAt <= now) {
      cancelledTalkSpeech.delete(entryKey);
    }
  }
  for (const [connectionId, expiresAt] of saturatedTalkSpeechConnections) {
    if (expiresAt <= now) {
      saturatedTalkSpeechConnections.delete(connectionId);
    }
  }
}

export function resetTalkSpeechCancellationForTests(): void {
  for (const entry of activeTalkSpeech.values()) {
    entry.controller.abort();
  }
  activeTalkSpeech.clear();
  cancelledTalkSpeech.clear();
  saturatedTalkSpeechConnections.clear();
}
