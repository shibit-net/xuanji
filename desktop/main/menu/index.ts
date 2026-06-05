// ============================================================
// macOS 应用菜单 — 精简专业的 AI Agent 桌面应用菜单
// ============================================================

import { app, Menu, BrowserWindow, shell, dialog } from 'electron';

const isMac = process.platform === 'darwin';

export function buildAppMenu(appIcon?: Electron.NativeImage | null) {
  const appName = app.name; // '璇玑'
  const version = app.getVersion();

  const template: Electron.MenuItemConstructorOptions[] = [
    // ── App 菜单 (macOS only) ──────────────────────────
    ...(isMac
      ? [
          {
            label: appName,
            submenu: [
              {
                label: `关于 ${appName}`,
                click: () => {
                  dialog.showMessageBox({
                    type: 'info',
                    title: `关于 ${appName}`,
                    message: appName,
                    detail: `版本: ${version}\n\nAI Agent 桌面工作站\n高效、智能的 AI 编程助手`,
                    buttons: ['确定'],
                    ...(appIcon ? { icon: appIcon } : {}),
                  });
                },
              },
              { type: 'separator' as const },
              { role: 'services' as const, label: '服务' },
              { type: 'separator' as const },
              { role: 'hide' as const, label: `隐藏 ${appName}` },
              { role: 'hideOthers' as const, label: '隐藏其他' },
              { role: 'unhide' as const, label: '全部显示' },
              { type: 'separator' as const },
              { role: 'quit' as const, label: `退出 ${appName}` },
            ],
          },
        ]
      : []),

    // ── 文件 ──────────────────────────────────────────
    {
      label: '文件',
      submenu: [
        {
          label: '新建对话',
          accelerator: 'CmdOrCtrl+N',
          click: (_menuItem, browserWindow) => {
            browserWindow?.webContents.send('menu:new-chat');
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const, label: '关闭窗口' } : { role: 'quit' as const, label: '退出' },
      ],
    },

    // ── 编辑 ──────────────────────────────────────────
    {
      label: '编辑',
      submenu: [
        { role: 'undo' as const, label: '撤销' },
        { role: 'redo' as const, label: '重做' },
        { type: 'separator' as const },
        { role: 'cut' as const, label: '剪切' },
        { role: 'copy' as const, label: '复制' },
        { role: 'paste' as const, label: '粘贴' },
        { role: 'selectAll' as const, label: '全选' },
      ],
    },

    // ── 视图 ──────────────────────────────────────────
    {
      label: '视图',
      submenu: [
        {
          label: '切换侧栏',
          accelerator: 'CmdOrCtrl+B',
          click: (_menuItem, browserWindow) => {
            browserWindow?.webContents.send('menu:toggle-sidebar');
          },
        },
        { type: 'separator' },
        { role: 'reload' as const, label: '重新加载' },
        { role: 'forceReload' as const, label: '强制重新加载' },
        { role: 'toggleDevTools' as const, label: '开发者工具 (⌘⌥I)', accelerator: 'CmdOrCtrl+Option+I' },
        { type: 'separator' },
        { role: 'togglefullscreen' as const, label: '全屏' },
      ],
    },

    // ── 窗口 ──────────────────────────────────────────
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' as const, label: '最小化' },
        { role: 'zoom' as const, label: '缩放' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const, label: '全部置于顶层' },
            ]
          : [{ role: 'close' as const, label: '关闭窗口' }]),
      ],
    },

    // ── 帮助 ──────────────────────────────────────────
    {
      label: '帮助',
      submenu: [
        {
          label: '使用帮助',
          click: () => {
            shell.openExternal('https://work.weixin.qq.com/ca/cawcde6fa830e97aad');
          },
        },
        {
          label: '反馈问题',
          click: () => {
            shell.openExternal('https://work.weixin.qq.com/ca/cawcde6fa830e97aad');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
