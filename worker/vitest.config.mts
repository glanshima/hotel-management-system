import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    // Run tests sequentially to avoid D1 write conflicts in the shared local DB
    poolOptions: {
      workers: {
        singleWorker: true,
      },
    },
  },
});
