import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "node_modules/**", "templates/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((configuration) => ({
    ...configuration,
    files: ["**/*.ts"],
  })),
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error"
    },
  },
  {
    files: ["**/runtime/**/*.js"],
    languageOptions: {
      globals: {
        Application: "readonly",
        ObjC: "readonly",
        Path: "readonly",
        $: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
    },
  },
);
