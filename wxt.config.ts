import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'xNotes',
    description:
      'Private notes for X/Twitter profiles. Local-first, with optional end-to-end encrypted sync to your own WebDAV or S3 storage.',
    permissions: ['storage', 'alarms'],
    host_permissions: [
      'https://x.com/*',
      'https://www.x.com/*',
      'https://twitter.com/*',
      'https://www.twitter.com/*',
    ],
    optional_host_permissions: ['https://*/*'],
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: '{9c4f2a1e-8b3d-4e5f-a6c7-1d2e3f4a5b6c}',
              strict_min_version: '142.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
          action: {
            theme_icons: [
              { light: 'icons/icon-16-light.png', dark: 'icons/icon-16-dark.png', size: 16 },
              { light: 'icons/icon-32-light.png', dark: 'icons/icon-32-dark.png', size: 32 },
            ],
          },
        }
      : {}),
  }),
});
