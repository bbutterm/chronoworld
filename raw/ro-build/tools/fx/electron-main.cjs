// Minimal Electron shell for effect capture under Xvfb (software WebGL via SwiftShader).
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('mute-audio');
const [w, h] = (process.env.CAP_SIZE || '840x720').split('x').map(Number);
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: w, height: h, useContentSize: true, show: true,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
  win.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
