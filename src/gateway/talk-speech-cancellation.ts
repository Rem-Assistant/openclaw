type TalkSpeechCancellationEntry = {
  connectionId: string;
  previewId: string;
  controller: AbortController;
};

const activeTalkSpeech = new Map<string, TalkSpeechCancellationEntry>();

function key(connectionId: string, previewId: string): string {
  return `${connectionId}\u0000${previewId}`;
}

export function beginTalkSpeech(connectionId: string, previewId: string): AbortController {
  const entryKey = key(connectionId, previewId);
  activeTalkSpeech.get(entryKey)?.controller.abort();
  const controller = new AbortController();
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
  const entryKey = key(connectionId, previewId);
  const entry = activeTalkSpeech.get(entryKey);
  if (!entry) {
    return false;
  }
  activeTalkSpeech.delete(entryKey);
  entry.controller.abort();
  return true;
}

export function cancelTalkSpeechForConnection(connectionId: string): number {
  let cancelled = 0;
  for (const [entryKey, entry] of activeTalkSpeech) {
    if (entry.connectionId !== connectionId) {
      continue;
    }
    activeTalkSpeech.delete(entryKey);
    entry.controller.abort();
    cancelled += 1;
  }
  return cancelled;
}

export function resetTalkSpeechCancellationForTests(): void {
  for (const entry of activeTalkSpeech.values()) {
    entry.controller.abort();
  }
  activeTalkSpeech.clear();
}
