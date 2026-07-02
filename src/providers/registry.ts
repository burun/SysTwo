import type { Provider } from "../core/types.js";
import { SysTwoError } from "../core/errors.js";
import { mockProvider } from "./mock/provider.js";
import { codeBuddyProvider } from "./codebuddy/provider.js";

const providers = new Map<string, Provider>([
  [mockProvider.id, mockProvider],
  [codeBuddyProvider.id, codeBuddyProvider]
]);

export function getProvider(id = "mock"): Provider {
  const provider = providers.get(id);
  if (!provider) {
    throw new SysTwoError(
      `Unknown provider "${id}". Available providers: ${[...providers.keys()].join(", ")}.`,
      "UNKNOWN_PROVIDER"
    );
  }
  return provider;
}

export function listProviders(): Provider[] {
  return [...providers.values()];
}
