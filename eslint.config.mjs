import nextConfig from "eslint-config-next";

const eslintConfig = [
  // Next.js recommended config (includes React, TypeScript, etc.)
  ...nextConfig,

  // Additional ignores
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
    ],
  },

  // Custom rules for app code
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Allow unused vars prefixed with underscore
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Allow explicit any in specific cases (with warning)
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // Relaxed rules for scripts (test/debug utilities)
  {
    files: ["scripts/**/*.ts", "workers/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-console": "off",
    },
  },
];

export default eslintConfig;
