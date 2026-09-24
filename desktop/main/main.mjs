import { app, dialog } from 'electron';
import { onRuntimeFailure, startRuntime, stopRuntime } from './runtime.mjs';
import { createMainWindow } from './window.mjs';

let quitting = false;
let cleanupPromise;

function quitAfterRuntimeStops() {
  if (!cleanupPromise) cleanupPromise = stopRuntime();
  return cleanupPromise;
}

app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void quitAfterRuntimeStops().finally(() => app.quit());
});

app.on('window-all-closed', () => app.quit());

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    quitting = true;
    void quitAfterRuntimeStops().finally(() => app.quit());
  });
}

app.whenReady().then(async () => {
  onRuntimeFailure((error) => {
    void dialog
      .showMessageBox({
        type: 'error',
        title: 'OpenMAIC runtime stopped',
        message: 'The local OpenMAIC server stopped unexpectedly.',
        detail: error.message,
      })
      .finally(() => app.quit());
  });

  try {
    const { url } = await startRuntime();
    if (!quitting) {
      console.log('[desktop] creating BrowserWindow');
      createMainWindow(url);
    }
  } catch (error) {
    if (quitting) return;
    console.error(`[desktop] OpenMAIC runtime failed: ${error.message}`);
    await quitAfterRuntimeStops();
    await dialog.showMessageBox({
      type: 'error',
      title: 'Could not start OpenMAIC',
      message: 'The local OpenMAIC server could not be started.',
      detail: error.stack ?? error.message,
    });
    app.quit();
  }
});
