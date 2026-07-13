import type { ProofHostApi } from "@aigc-proof/host-contracts";

export * from "@aigc-proof/host-contracts";

declare global {
  interface Window {
    aigcProof: ProofHostApi;
  }
}
