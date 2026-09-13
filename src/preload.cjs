const { contextBridge, ipcRenderer } = require('electron');
const commands = new Set(['state', 'chat-memory', 'save-chat', 'clear-chat', 'suggestions', 'new-tab', 'switch-tab', 'close-tab', 'navigate', 'back', 'forward', 'reload', 'stop', 'bookmark', 'remove-bookmark', 'clear-history', 'bounds', 'overlay', 'minimize', 'maximize', 'close-window', 'find', 'settings', 'connect-ai', 'page', 'ask', 'cancel-ai', 'voice-arm', 'transcribe', 'show-download', 'feature-starter', 'build-feature', 'cancel-feature', 'install-feature', 'remove-feature', 'rollback-feature', 'feature-data', 'save-feature-data']);
commands.add('preview-feature');
commands.add('cancel-connect-ai');
commands.add('training');
commands.add('clear-learning');
commands.add('screen-learning');
commands.add('screen-learning-capture');
commands.add('emergency-stop');
for (const command of ['library-state', 'library-folder', 'library-import', 'library-file', 'library-dismiss', 'library-cancel', 'library-reveal']) commands.add(command);
contextBridge.exposeInMainWorld('jarvis', {
  invoke(command, payload = {}) {
    if (!commands.has(command)) return Promise.reject(new Error('Unknown command'));
    return ipcRenderer.invoke('jarvis:invoke', command, payload);
  },
  onEvent(callback) {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on('jarvis:event', handler);
    return () => ipcRenderer.removeListener('jarvis:event', handler);
  },
});
