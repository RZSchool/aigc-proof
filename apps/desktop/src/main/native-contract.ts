import {
  HostContractError,
  type NativeDiscovery,
  validateNativeDiscovery,
} from "@aigc-proof/host-contracts";

export interface DiscoverableNativeAddon {
  getApiInfo(): unknown;
}

export function validateNativeAddonDiscovery(
  candidate: unknown,
): NativeDiscovery {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("getApiInfo" in candidate) ||
    typeof candidate.getApiInfo !== "function"
  ) {
    throw new HostContractError(
      "NATIVE_DISCOVERY_MISSING",
      "Native addon does not expose getApiInfo().",
    );
  }
  let discovery: unknown;
  try {
    discovery = candidate.getApiInfo();
  } catch {
    throw new HostContractError(
      "NATIVE_DISCOVERY_INVALID",
      "Native addon discovery failed before proof IPC registration.",
    );
  }
  return validateNativeDiscovery(discovery);
}
