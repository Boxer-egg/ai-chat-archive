import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // 零上传红线（README 硬性约束）：全库禁止网络 API
      'no-restricted-globals': ['error', 'fetch', 'XMLHttpRequest', 'WebSocket', 'sendBeacon'],
      // 与 tsconfig noUnusedParameters:false 对齐：_ 前缀表示有意未用
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
