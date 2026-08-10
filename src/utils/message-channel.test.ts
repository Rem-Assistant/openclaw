import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChannelPlugin } from "../channels/plugins/types.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createChannelTestPluginBase, createTestRegistry } from "../test-utils/channel-plugins.js";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  INTERNAL_NON_DELIVERY_CHANNELS,
  isInternalNonDeliveryChannel,
  isMarkdownCapableMessageChannel,
  isOperatorUiClient,
  resolveNativeAppChatPromptSurface,
  resolveGatewayMessageChannel,
  shouldSuppressChatSenderIdentity,
} from "./message-channel.js";

const emptyRegistry = createTestRegistry([]);
const demoAliasPlugin: ChannelPlugin = {
  ...createChannelTestPluginBase({
    id: "demo-alias-channel",
    label: "Demo Alias Channel",
    docsPath: "/channels/demo-alias-channel",
  }),
  meta: {
    ...createChannelTestPluginBase({
      id: "demo-alias-channel",
      label: "Demo Alias Channel",
      docsPath: "/channels/demo-alias-channel",
    }).meta,
    aliases: ["workspace-chat"],
  },
};

const demoMarkdownPlugin: ChannelPlugin = {
  ...createChannelTestPluginBase({
    id: "demo-markdown-channel",
    label: "Demo Markdown Channel",
    docsPath: "/channels/demo-markdown-channel",
    markdownCapable: true,
  }),
};

describe("message-channel", () => {
  beforeEach(() => {
    setActivePluginRegistry(emptyRegistry);
  });

  afterEach(() => {
    setActivePluginRegistry(emptyRegistry);
  });

  it("normalizes gateway message channels and rejects unknown values", () => {
    expect(resolveGatewayMessageChannel("discord")).toBe("discord");
    expect(resolveGatewayMessageChannel(" imsg ")).toBe("imessage");
    expect(resolveGatewayMessageChannel("web")).toBeUndefined();
    expect(resolveGatewayMessageChannel("nope")).toBeUndefined();
  });

  it("normalizes plugin aliases when registered", () => {
    setActivePluginRegistry(
      createTestRegistry([
        { pluginId: "demo-alias-channel", plugin: demoAliasPlugin, source: "test" },
      ]),
    );
    expect(resolveGatewayMessageChannel("workspace-chat")).toBe("demo-alias-channel");
  });

  it("recognises internal non-delivery channel sources", () => {
    for (const channel of INTERNAL_NON_DELIVERY_CHANNELS) {
      expect(isInternalNonDeliveryChannel(channel)).toBe(true);
    }
    expect(isInternalNonDeliveryChannel("telegram")).toBe(false);
    expect(isInternalNonDeliveryChannel("webchat")).toBe(false);
    expect(isInternalNonDeliveryChannel("")).toBe(false);
    expect(isInternalNonDeliveryChannel("HEARTBEAT")).toBe(false);
  });

  it("reads markdown capability from channel metadata", () => {
    expect(isMarkdownCapableMessageChannel("telegram")).toBe(true);
    expect(isMarkdownCapableMessageChannel("whatsapp")).toBe(false);
    setActivePluginRegistry(
      createTestRegistry([
        { pluginId: "demo-markdown-channel", plugin: demoMarkdownPlugin, source: "test" },
      ]),
    );
    expect(isMarkdownCapableMessageChannel("demo-markdown-channel")).toBe(true);
  });

  it.each([
    GATEWAY_CLIENT_NAMES.IOS_APP,
    GATEWAY_CLIENT_NAMES.MACOS_APP,
    GATEWAY_CLIENT_NAMES.ANDROID_APP,
  ])("suppresses native app chat sender identity only in UI mode (%s)", (id) => {
    expect(shouldSuppressChatSenderIdentity({ id, mode: GATEWAY_CLIENT_MODES.UI })).toBe(true);
    expect(shouldSuppressChatSenderIdentity({ id, mode: GATEWAY_CLIENT_MODES.NODE })).toBe(false);
    expect(isOperatorUiClient({ id, mode: GATEWAY_CLIENT_MODES.UI })).toBe(false);
    expect(isOperatorUiClient({ id, mode: GATEWAY_CLIENT_MODES.NODE })).toBe(false);
    expect(resolveNativeAppChatPromptSurface({ id, mode: GATEWAY_CLIENT_MODES.UI })).toBe("rem");
    expect(
      resolveNativeAppChatPromptSurface({ id, mode: GATEWAY_CLIENT_MODES.NODE }),
    ).toBeUndefined();
  });

  it("retains mode-independent Control UI and TUI classification", () => {
    expect(
      isOperatorUiClient({
        id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
        mode: GATEWAY_CLIENT_MODES.WEBCHAT,
      }),
    ).toBe(true);
    expect(
      isOperatorUiClient({ id: GATEWAY_CLIENT_NAMES.TUI, mode: GATEWAY_CLIENT_MODES.CLI }),
    ).toBe(true);
    expect(
      shouldSuppressChatSenderIdentity({
        id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
        mode: GATEWAY_CLIENT_MODES.WEBCHAT,
      }),
    ).toBe(true);
    expect(
      shouldSuppressChatSenderIdentity({
        id: GATEWAY_CLIENT_NAMES.TUI,
        mode: GATEWAY_CLIENT_MODES.CLI,
      }),
    ).toBe(true);
    expect(
      resolveNativeAppChatPromptSurface({
        id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
        mode: GATEWAY_CLIENT_MODES.WEBCHAT,
      }),
    ).toBeUndefined();
    expect(
      resolveNativeAppChatPromptSurface({
        id: GATEWAY_CLIENT_NAMES.TUI,
        mode: GATEWAY_CLIENT_MODES.CLI,
      }),
    ).toBeUndefined();
  });
});
