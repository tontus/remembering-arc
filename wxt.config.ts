import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // Explicit imports keep every dependency visible, including the browser port's.
  imports: false,
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // 134 is the first version whose bookmark nodes carry `folderType` and `syncing`.
    minimum_chrome_version: '134',
    permissions: ['bookmarks', 'favicon', 'scripting', 'sidePanel', 'storage'],
    // Auto-hide adds its overlay to every website, so the extension asks for this only when
    // the user turns Auto-hide on (ADR-0003).
    optional_host_permissions: ['<all_urls>'],
    // The Auto-hide overlay shows the sidebar page in a frame inside web pages.
    web_accessible_resources: [{ resources: ['sidepanel.html'], matches: ['<all_urls>'] }],
    commands: {
      'toggle-sidebar-mode': {
        suggested_key: { default: 'Ctrl+Shift+S', mac: 'Command+Shift+S' },
        description: '__MSG_toggleSidebarModeCommand__',
      },
    },
    action: {
      default_title: '__MSG_actionTitle__',
    },
  },
});
