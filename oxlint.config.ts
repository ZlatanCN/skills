import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

export default defineConfig({
  extends: [core],
  ignorePatterns: [...(core.ignorePatterns ?? []), ".agents/**"],
  rules: {
    "func-style": ["error", "declaration"],
    "typescript/consistent-type-definitions": ["error", "type"],
  },
});
