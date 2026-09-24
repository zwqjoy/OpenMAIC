import { BrowserWindow, shell } from 'electron';
import path from 'node:path';

function isInternalUrl(candidate, internalOrigin) {
  try {
    return new URL(candidate).origin === internalOrigin;
  } catch {
    return false;
  }
}

function openExternal(candidate) {
  try {
    const url = new URL(candidate);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      void shell.openExternal(url.href);
    }
  } catch {
    // Ignore malformed navigation targets.
  }
}

export function createMainWindow(url) {
  const internalOrigin = new URL(url).origin;
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    show: false,
    webPreferences: {
      preload: path.join(import.meta.dirname, '..', 'preload', 'index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isInternalUrl(target, internalOrigin)) return { action: 'allow' };
    openExternal(target);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (!isInternalUrl(target, internalOrigin)) {
      event.preventDefault();
      openExternal(target);
    }
  });
  window.once('ready-to-show', () => window.show());
  void window.loadURL(url);
  return window;
}
