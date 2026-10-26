import tseslint from 'typescript-eslint'

// Reglas orientadas a detectar errores asíncronos (p. ej. un `await` olvidado en una consulta SQL).
export default tseslint.config(
  { ignores: ['data', 'node_modules'] },
  {
    files: ['src/**/*.ts'],
    extends: [tseslint.configs.base],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false } }],
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  {
    // En las pruebas, test() devuelve una promesa que gestiona node:test: los await olvidados los detecta tsc al usar el resultado.
    files: ['test/**/*.ts'],
    extends: [tseslint.configs.base],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/await-thenable': 'error',
    },
  }
)
