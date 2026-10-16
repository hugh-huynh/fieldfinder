import js from "@eslint/js";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

const DB_RESTRICTED_PATH = { name: "postgres", message: "Use publicDb()/adminDb() from src/lib/db (ADR-0002)." };
const DB_CLIENT_PATTERN = {
  group: ["@/lib/db/client", "**/lib/db/client"],
  message: "Use publicDb()/adminDb(); only src/lib/db creates connections (ADR-0002).",
};
const DB_ADMIN_PATTERN = {
  group: ["@/lib/db/admin", "**/lib/db/admin"],
  message: "The writer connection is only for /api/admin routes; use publicDb() (ADR-0002).",
};

export default tseslint.config(
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "playwright-report/**", "test-results/**", "next-env.d.ts"],
  },
  js.configs.recommended,
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...jsxA11y.flatConfigs.strict.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  // ADR-0002: only src/lib/db talks to Postgres, and the writer role is only for /api/admin routes.
  // Flat config replaces (not merges) a rule's options per file, so the second block repeats the
  // first block's restrictions and adds the writer one; /api/admin only gets the first.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/db/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: [DB_RESTRICTED_PATH], patterns: [DB_CLIENT_PATTERN] }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/db/**", "src/app/api/admin/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [DB_RESTRICTED_PATH], patterns: [DB_CLIENT_PATTERN, DB_ADMIN_PATTERN] },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
