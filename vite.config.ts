import { defineConfig } from 'vite';
import { crx, defineManifest } from '@crxjs/vite-plugin';

// 域名清单唯一事实来源：manifest 与适配器开发期校验都用它。
export const PLATFORM_HOSTS = [
  'https://chat.deepseek.com/*',
  'https://*.kimi.com/*',
  'https://kimi.moonshot.cn/*',
  'https://claude.ai/*',
  'https://chatgpt.com/*',
  'https://chat.openai.com/*',
  'https://grok.com/*',
];

const manifest = defineManifest({
  manifest_version: 3,
  name: 'AI 对话本地归档',
  version: '0.1.0',
  minimum_chrome_version: '120',
  incognito: 'not_allowed',
  description: '把 AI 对话自动保存到本地浏览器数据库。仅本地，不上传任何数据。',
  permissions: ['storage', 'unlimitedStorage', 'alarms'],
  host_permissions: PLATFORM_HOSTS,
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  content_scripts: [
    {
      matches: PLATFORM_HOSTS,
      js: ['src/content/bootstrap.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  action: { default_title: 'AI 对话本地归档', default_popup: 'popup.html' },
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'none'; connect-src 'none'; worker-src 'self'",
  },
});

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    sourcemap: true,
    rollupOptions: {
      input: {
        // popup.html 由 crxjs 经 manifest 自动纳入；archive 在此显式声明
        archive: 'archive.html',
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // jsdom 环境留给解析类测试（在文件里用 // @vitest-environment jsdom 标注）
  },
});
