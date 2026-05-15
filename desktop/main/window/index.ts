import { app, BrowserWindow, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { enhancedMessageBus } from '../ipc/GlobalMessageBus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  // app.getAppPath() 在生产环境返回 asar 文件路径
  // icon 在 asar 内的 build/icon.png
  const appPath = app.getAppPath();
  const iconPath = path.join(appPath, 'build/icon.png');

  // dev 模式下也设置 dock 图标
  if (app.dock) {
    try {
      if (fs.existsSync(iconPath)) {
        const iconBuffer = fs.readFileSync(iconPath);
        const dockIcon = nativeImage.createFromBuffer(iconBuffer);
        if (!dockIcon.isEmpty()) {
          app.dock.setIcon(dockIcon);
        }
      }
    } catch (e) {
      console.error('[Window] dock icon error:', e);
    }
  }

  const isMac = process.platform === 'darwin';

  // macOS: hiddenInset 实现无边框 + 内嵌红绿灯
  // Windows/Linux: frame=false 隐藏原生标题栏, 由 renderer 自定义 TitleBar 接管
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#1E1E1E',
    show: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  };

  if (isMac) {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.frame = true;
  } else {
    // Windows / Linux: 无原生边框，完全由自定义 TitleBar 控制
    windowOptions.frame = false;
    windowOptions.autoHideMenuBar = true;
  }

  mainWindow = new BrowserWindow(windowOptions);

  // 监听加载失败
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Window] 页面加载失败: ${errorDescription} (${errorCode}) URL: ${validatedURL}`);
  });

  // ready-to-show 时再显示窗口，避免白屏闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 🔧 设置 mainWindow 到 enhancedMessageBus，使其能够转发消息到 renderer
  enhancedMessageBus.setMainWindow(mainWindow);

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:9100';
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    // 使用相对路径加载 ASAR 内的 HTML（__dirname = dist-electron/）
    const distPath = path.join(__dirname, '..', 'dist', 'index.html');
    mainWindow.loadFile(distPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    // 🔧 窗口关闭时清除 mainWindow 引用
    enhancedMessageBus.setMainWindow(null);
  });
}

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function minimizeWindow() {
  mainWindow?.minimize();
}

function maximizeWindow() {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
}

function closeWindow() {
  mainWindow?.close();
}

export {
  createWindow,
  getMainWindow,
  minimizeWindow,
  maximizeWindow,
  closeWindow
};
