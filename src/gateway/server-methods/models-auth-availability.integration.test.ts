import { afterEach, describe, expect, it } from "vitest";
import type { AuthProfileStore } from "../../agents/auth-profiles.js";
import { hasAvailableAuthForProvider } from "../../agents/model-auth.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";

const credentialEnvironmentKey = "MODEL_AUTH_AVAILABILITY_TEST_KEY";
const originalCredential = process.env[credentialEnvironmentKey];
const emptyStore: AuthProfileStore = { version: 1, profiles: {} };
const cfg: OpenClawConfig = {
  models: {
    providers: {
      "private-provider": {
        baseUrl: "https://models.example.test/v1",
        apiKey: { source: "env", provider: "default", id: credentialEnvironmentKey },
        models: [{ id: "private-test", name: "Private Test" }],
      },
    },
  },
};

afterEach(() => {
  if (originalCredential === undefined) {
    delete process.env[credentialEnvironmentKey];
  } else {
    process.env[credentialEnvironmentKey] = originalCredential;
  }
});

describe("model auth availability runtime integration", () => {
  it("does not treat a configured catalog provider as usable auth", async () => {
    delete process.env[credentialEnvironmentKey];

    await expect(
      hasAvailableAuthForProvider({
        provider: "private-provider",
        cfg,
        store: emptyStore,
      }),
    ).resolves.toBe(false);
  });

  it("reports a provider when the runtime can resolve its environment credential", async () => {
    process.env[credentialEnvironmentKey] = "integration-test-key"; // pragma: allowlist secret

    await expect(
      hasAvailableAuthForProvider({
        provider: "private-provider",
        cfg,
        store: emptyStore,
      }),
    ).resolves.toBe(true);
  });
});
