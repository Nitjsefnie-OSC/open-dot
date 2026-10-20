import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["drizzle/**"],
    plugins: ["typescript", "import", "unicorn", "oxc"],
    categories: { correctness: "error", suspicious: "error" },
    rules: {
      "typescript/no-explicit-any": "error",
      "typescript/no-non-null-assertion": "error",
      "typescript/consistent-type-imports": "error",
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      "import/no-duplicates": "error",
      "eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  fmt: {
    ignorePatterns: ["drizzle/**"],
  },
});
