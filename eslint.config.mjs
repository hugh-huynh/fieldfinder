import js from "@eslint/js";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

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
  {
    // ADR-0002: only src/lib/db talks to Postgres, and the writer role is only for /api/admin routes.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/db/**", "src/app/api/admin/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "postgres", message: "Use publicDb() from @/lib/db/public (ADR-0002)." }],
          patterns: [
            {
              group: ["@/lib/db/admin", "@/lib/db/client", "**/lib/db/admin", "**/lib/db/client"],
              message:
                "Use publicDb() from @/lib/db/public; the writer connection is only for /api/admin routes (ADR-0002).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
