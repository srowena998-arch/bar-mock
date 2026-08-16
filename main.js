// Bar 2026 Mock Reviewer — Electron Desktop Wrapper with Auto GitHub Sync
const { app, BrowserWindow, shell } = require('electron');
const { execSync, spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const PORT = 8080;
let mainWindow = null;
let serverProcess = null;

// 1. Auto-Fetch & Pull Updates from GitHub on Startup
function syncGitHubUpdates() {
  console.log('🔄 Checking for latest updates from GitHub...');
  try {
    const pullResult = execSync('git pull origin main', { cwd: __dirname, encoding: 'utf8', timeout: 8000 });
    console.log('GitHub Sync Result:', pullResult.trim());
  } catch (err) {
    console.log('⚠️ GitHub Sync skipped (offline or network error). Running in offline mode.');
  }
}

// 2. Start Embedded Server Process (Only if not already running)
function startServer() {
  http.get(`http://localhost:${PORT}/api/domains`, (res) => {
    console.log('✅ Connected to existing Bar Mock Reviewer Engine.');
  }).on('error', () => {
    console.log('🚀 Spawning internal server on port ' + PORT + '...');
    serverProcess = spawn('node', ['server.js'], {
      cwd: __dirname,
      stdio: 'ignore',
      env: { ...process.env, PORT: PORT }
    });
  });
}

function waitForServer(callback) {
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    http.get(`http://localhost:${PORT}/api/domains`, (res) => {
      if (res.statusCode === 200) {
        clearInterval(interval);
        callback();
      }
    }).on('error', () => {
      if (attempts >= 30) {
        clearInterval(interval);
        callback();
      }
    });
  }, 200);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 880,
    minWidth: 420,
    minHeight: 600,
    title: 'BAR 2026 Mock Reviewer & Supreme Court AI Platform',
    icon: path.join(__dirname, 'app_icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Open external links in default system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.setName('Bar 2026 Mock Reviewer');
if (process.platform === 'win32') {
  app.setAppUserModelId('ph.supremecourt.barmock2026');
}

app.whenReady().then(() => {
  syncGitHubUpdates();
  startServer();
  waitForServer(() => {
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    try { serverProcess.kill(); } catch (e) {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
