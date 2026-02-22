// ============================================================
// electron-builder 打包配置
// ============================================================

module.exports = {
  appId: 'com.xuanji.app',
  productName: 'Xuanji',
  copyright: 'Copyright 2025 Shibit',

  directories: {
    output: 'release',
    buildResources: 'build',
  },

  files: [
    'dist/**/*',
    'src/adapters/electron/ui/**/*',
    'package.json',
  ],

  // Windows 配置
  win: {
    target: ['nsis', 'portable'],
    icon: 'build/icon.ico',
    artifactName: '${productName}-${version}-${arch}.${ext}',
    certificateFile: process.env.WIN_CSC_LINK || undefined,
    certificatePassword: process.env.WIN_CSC_KEY_PASSWORD || undefined,
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Xuanji',
    installerHeaderIcon: 'build/icon.ico',
  },

  // macOS 配置
  mac: {
    target: ['dmg', 'zip'],
    icon: 'build/icon.icns',
    category: 'public.app-category.developer-tools',
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },

  dmg: {
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
  },

  // Linux 配置
  linux: {
    target: ['AppImage', 'deb'],
    icon: 'build/icon.png',
    category: 'Development',
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },

  // asar 打包
  asar: true,
  asarUnpack: [
    'node_modules/ws/**/*',
  ],

  // 排除开发依赖
  npmRebuild: true,

  // 发布配置
  publish: null,
};
