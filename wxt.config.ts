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
    permissions: ['bookmarks', 'favicon', 'sidePanel'],
    action: {
      default_title: '__MSG_actionTitle__',
    },
  },
});
