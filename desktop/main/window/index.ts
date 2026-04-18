import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#1E1E1E',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:9100';
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
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
