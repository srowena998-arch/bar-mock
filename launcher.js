// Bar 2026 Mock Reviewer — Native Windows App Launcher with Auto GitHub Sync
const { execSync, spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const PORT = process.env.PORT || 8080;
const REPO_DIR = __dirname;

console.clear ? console.clear() : null;
console.log('======================================================');
console.log('⚖️  BAR 2026 MOCK REVIEWER — NATIVE WINDOWS APP');
console.log('🏛️  Supreme Court Mock Simulation & Resources Studio');
console.log('======================================================\n');

// 1. Auto-Fetch & Pull Updates from GitHub
console.log('🔄 Checking for latest updates from GitHub repository...');
try {
  const gitStatus = execSync('git status -s', { cwd: REPO_DIR, encoding: 'utf8', timeout: 4000 });
  
  // Try pulling latest changes
  const pullOutput = execSync('git pull origin main', { cwd: REPO_DIR, encoding: 'utf8', timeout: 10000 });
  if (pullOutput.includes('Already up to date')) {
    console.log('✅ Repository is up to date with origin/main.');
  } else {
    console.log('✨ Successfully pulled latest updates from GitHub:');
    console.log(pullOutput.trim().split('\n').map(l => '   ' + l).join('\n'));
  }
} catch (err) {
  console.log('⚠️ Note: GitHub sync skipped or offline (running in offline local mode).');
}

// 2. Start Background Server
console.log('\n🚀 Starting internal Bar Mock Reviewer Engine...');
const serverProcess = spawn('node', ['server.js'], {
  cwd: REPO_DIR,
  stdio: 'inherit',
  env: { ...process.env, PORT: PORT }
});

serverProcess.on('error', (err) => {
  console.error('❌ Failed to start server process:', err.message);
  process.exit(1);
});

// Helper to poll until server is ready
const waitForServer = (port, maxAttempts = 30) => {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      http.get(`http://localhost:${port}/api/domains`, (res) => {
        if (res.statusCode === 200) {
          clearInterval(interval);
          resolve(true);
        }
      }).on('error', () => {
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          reject(new Error('Server failed to respond in time'));
        }
      });
    }, 200);
  });
};

// 3. Locate Native Windows App Runtime (Edge / Chrome App Mode)
const getBrowserAppPath = () => {
  const possiblePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
  ];

  for (const p of possiblePaths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
};

// 4. Launch Standalone Native Window
(async () => {
  try {
    await waitForServer(PORT);
    console.log(`\n🌐 Engine ready at http://localhost:${PORT}`);
    
    const appUrl = `http://localhost:${PORT}`;
    const electronBinary = path.join(REPO_DIR, 'node_modules', '.bin', 'electron.cmd');

    // 1. Priority: True Electron Native Application (Custom Icon in Taskbar)
    if (fs.existsSync(electronBinary)) {
      console.log('🖥️ Launching Standalone Electron Native Window (Custom Taskbar Icon)...');
      const electronProcess = spawn(electronBinary, ['.'], {
        cwd: REPO_DIR,
        stdio: 'inherit',
        env: { ...process.env, PORT: PORT }
      });

      electronProcess.on('exit', () => {
        console.log('\n🛑 Application window closed. Shutting down server engine...');
        try { serverProcess.kill(); } catch (e) {}
        process.exit(0);
      });
      return;
    }

    // 2. Secondary: Edge / Chrome App Mode
    const browserPath = getBrowserAppPath();
    const userDataDir = path.join(process.env.LOCALAPPDATA || 'C:\\temp', 'BarMock2026_UserData');

    if (browserPath) {
      console.log('🖥️ Launching Native Windows App Window (Edge App Mode)...');
      
      const appWindow = spawn(browserPath, [
        `--app=${appUrl}`,
        `--user-data-dir=${userDataDir}`,
        '--window-size=1366,880',
        '--window-position=100,60',
        '--enable-features=OverlayScrollbar',
        '--no-first-run',
        '--no-default-browser-check'
      ], { detached: false });

      // Clean exit when window is closed
      appWindow.on('exit', () => {
        console.log('\n🛑 Application window closed. Shutting down server engine...');
        try { serverProcess.kill(); } catch (e) {}
        process.exit(0);
      });
    } else {
      // 3. Fallback: Open default browser
      console.log('🖥️ Opening in default browser...');
      execSync(`start ${appUrl}`, { shell: 'cmd.exe' });
    }
  } catch (err) {
    console.error('❌ Launch Error:', err.message);
  }
})();

// Handle graceful termination
process.on('SIGINT', () => {
  try { serverProcess.kill(); } catch (e) {}
  process.exit(0);
});
process.on('SIGTERM', () => {
  try { serverProcess.kill(); } catch (e) {}
  process.exit(0);
});
