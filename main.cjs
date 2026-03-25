const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: "Vibrant - High Speed Capture",
    backgroundColor: '#E4E3E0'
  });

  if (isDev) {
    // In development, load from the Vite dev server
    win.loadURL('http://localhost:3000');
  } else {
    // In production, load the built index.html
    win.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  // Handle IPC messages
  ipcMain.on('quit-app', () => {
    app.quit();
  });

  // Open DevTools in development
  if (isDev) {
    win.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
