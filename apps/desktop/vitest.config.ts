import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@aigc-proof/host-contracts": fileURLToPath(
        new URL("./packages/host-contracts/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/renderer/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
