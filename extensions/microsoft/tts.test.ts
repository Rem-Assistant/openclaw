import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EdgeTTS } from "node-edge-tts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let edgeTTS: typeof import("./tts.js").edgeTTS;

function createEdgeTTSDeps(
  ttsPromise: (text: string, filePath: string, signal?: AbortSignal) => Promise<void>,
  onConstruct?: () => void,
) {
  return {
    EdgeTTS: class {
      constructor() {
        onConstruct?.();
      }

      ttsPromise(text: string, filePath: string, signal?: AbortSignal) {
        return ttsPromise(text, filePath, signal);
      }
    },
  };
}

const baseEdgeConfig = {
  voice: "en-US-MichelleNeural",
  lang: "en-US",
  outputFormat: "audio-24khz-48kbitrate-mono-mp3",
  saveSubtitles: false,
};

class FakeEdgeSocket extends EventEmitter {
  sentMessages: unknown[] = [];
  terminate = vi.fn();
  close = vi.fn();

  send(message: unknown) {
    this.sentMessages.push(message);
  }
}

describe("edgeTTS empty audio validation", () => {
  let tempDir: string | undefined;

  beforeAll(async () => {
    ({ edgeTTS } = await import("./tts.js"));
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("rejects blank text before constructing Edge TTS", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "tts-test-"));
    const outputPath = path.join(tempDir, "voice.mp3");
    const onConstruct = vi.fn();
    const deps = createEdgeTTSDeps(async (_text: string, filePath: string) => {
      writeFileSync(filePath, Buffer.from([0xff]));
    }, onConstruct);

    await expect(
      edgeTTS(
        {
          text: " \n\t ",
          outputPath,
          config: baseEdgeConfig,
          timeoutMs: 10000,
        },
        deps,
      ),
    ).rejects.toThrow("Microsoft TTS text cannot be empty");
    expect(onConstruct).not.toHaveBeenCalled();
  });

  it("throws after one retry when the output file stays empty", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "tts-test-"));
    const outputPath = path.join(tempDir, "voice.mp3");
    const calls: string[] = [];

    const deps = createEdgeTTSDeps(async (text: string, filePath: string) => {
      calls.push(text);
      writeFileSync(filePath, "");
    });

    await expect(
      edgeTTS(
        {
          text: "Hello",
          outputPath,
          config: baseEdgeConfig,
          timeoutMs: 10000,
        },
        deps,
      ),
    ).rejects.toThrow("Edge TTS produced empty audio file after retry");
    expect(calls).toEqual(["Hello", "Hello"]);
  });

  it("succeeds when the output file has content", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "tts-test-"));
    const outputPath = path.join(tempDir, "voice.mp3");
    let stagedPath = "";

    const deps = createEdgeTTSDeps(async (_text: string, filePath: string) => {
      stagedPath = filePath;
      writeFileSync(filePath, Buffer.from([0xff, 0xfb, 0x90, 0x00]));
    });

    await expect(
      edgeTTS(
        {
          text: "Hello",
          outputPath,
          config: baseEdgeConfig,
          timeoutMs: 10000,
        },
        deps,
      ),
    ).resolves.toBeUndefined();
    expect(stagedPath).not.toBe(outputPath);
    expect(path.basename(stagedPath)).toContain(path.basename(outputPath));
    expect(path.basename(stagedPath)).toMatch(/\.part$/);
    expect(readFileSync(outputPath)).toEqual(Buffer.from([0xff, 0xfb, 0x90, 0x00]));
    expect(existsSync(stagedPath)).toBe(false);
  });

  it("retries once when the first output file is empty", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "tts-test-"));
    const outputPath = path.join(tempDir, "voice.mp3");
    const calls: string[] = [];

    const deps = createEdgeTTSDeps(async (text: string, filePath: string) => {
      calls.push(text);
      writeFileSync(filePath, calls.length === 1 ? "" : Buffer.from([0xff, 0xfb, 0x90, 0x00]));
    });

    await expect(
      edgeTTS(
        {
          text: "Hello",
          outputPath,
          config: baseEdgeConfig,
          timeoutMs: 10000,
        },
        deps,
      ),
    ).resolves.toBeUndefined();
    expect(calls).toEqual(["Hello", "Hello"]);
  });

  it("retries once when Edge TTS resolves without creating an output file", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "tts-test-"));
    const outputPath = path.join(tempDir, "voice.mp3");
    const calls: string[] = [];

    const deps = createEdgeTTSDeps(async (text: string, filePath: string) => {
      calls.push(text);
      if (calls.length === 2) {
        writeFileSync(filePath, Buffer.from([0xff, 0xfb, 0x90, 0x00]));
      }
    });

    await expect(
      edgeTTS(
        {
          text: "Hello",
          outputPath,
          config: baseEdgeConfig,
          timeoutMs: 10000,
        },
        deps,
      ),
    ).resolves.toBeUndefined();
    expect(calls).toEqual(["Hello", "Hello"]);
  });

  it("does not retry provider errors", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "tts-test-"));
    const outputPath = path.join(tempDir, "voice.mp3");
    const calls: string[] = [];

    const deps = createEdgeTTSDeps(async (text: string) => {
      calls.push(text);
      throw new Error("upstream timeout");
    });

    await expect(
      edgeTTS(
        {
          text: "Hello",
          outputPath,
          config: baseEdgeConfig,
          timeoutMs: 10000,
        },
        deps,
      ),
    ).rejects.toThrow("upstream timeout");
    expect(calls).toEqual(["Hello"]);
  });

  it("passes cancellation through to the provider", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "tts-test-"));
    const outputPath = path.join(tempDir, "voice.mp3");
    const controller = new AbortController();
    const calls: string[] = [];
    let receivedSignal: AbortSignal | undefined;
    const deps = createEdgeTTSDeps(
      async (text: string, _filePath: string, signal?: AbortSignal) => {
        calls.push(text);
        receivedSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    );

    const pending = edgeTTS(
      {
        text: "Hello",
        outputPath,
        config: baseEdgeConfig,
        timeoutMs: 10000,
        signal: controller.signal,
      },
      deps,
    );
    await vi.waitFor(() => expect(calls).toEqual(["Hello"]));
    expect(receivedSignal).toBe(controller.signal);
    controller.abort(new Error("preview cancelled"));

    await expect(pending).rejects.toThrow("preview cancelled");
    expect(calls).toEqual(["Hello"]);
  });
});

describe("patched node-edge-tts cancellation", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("aborts a real connecting websocket without an unhandled error", async () => {
    const provider = new EdgeTTS({ timeout: 10000 });
    const controller = new AbortController();

    const pending = provider._connectWebSocket(controller.signal);
    controller.abort(new Error("connection cancelled"));

    await expect(pending).rejects.toThrow("connection cancelled");
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it("terminates the websocket and rejects promptly when aborted", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "edge-provider-test-"));
    const socket = new FakeEdgeSocket();
    const provider = new EdgeTTS({ timeout: 10000 });
    provider._connectWebSocket = async () => socket as never;
    const controller = new AbortController();

    const pending = provider.ttsPromise(
      "Hello",
      path.join(tempDir, "voice.mp3"),
      controller.signal,
    );
    await vi.waitFor(() => expect(socket.sentMessages).toHaveLength(1));
    controller.abort(new Error("preview cancelled"));

    await expect(pending).rejects.toThrow("preview cancelled");
    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(socket.listenerCount("message")).toBe(0);
  });

  it("terminates the websocket when synthesis times out", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "edge-provider-test-"));
    const socket = new FakeEdgeSocket();
    const provider = new EdgeTTS({ timeout: 5 });
    provider._connectWebSocket = async () => socket as never;

    await expect(provider.ttsPromise("Hello", path.join(tempDir, "voice.mp3"))).rejects.toThrow(
      "Timed out",
    );
    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(socket.listenerCount("message")).toBe(0);
  });

  it("applies the synthesis timeout while the websocket is still connecting", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "edge-provider-test-"));
    const provider = new EdgeTTS({ timeout: 5 });
    provider._connectWebSocket = async (signal?: AbortSignal) =>
      await new Promise<never>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });

    await expect(provider.ttsPromise("Hello", path.join(tempDir, "voice.mp3"))).rejects.toThrow(
      "Timed out",
    );
  });

  it("finishes the file after turn.end even when the remote socket closes first", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "edge-provider-test-"));
    const socket = new FakeEdgeSocket();
    const provider = new EdgeTTS({ timeout: 10000 });
    provider._connectWebSocket = async () => socket as never;

    const pending = provider.ttsPromise("Hello", path.join(tempDir, "voice.mp3"));
    await vi.waitFor(() => expect(socket.sentMessages).toHaveLength(1));
    socket.emit("message", Buffer.from("Path:turn.end"), false);
    socket.emit("close");

    await expect(pending).resolves.toBeUndefined();
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
