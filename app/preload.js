const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  loadLibrary: () => ipcRenderer.invoke('library:load'),
  scanLibrary: () => ipcRenderer.invoke('library:scan'),
  addFolder: () => ipcRenderer.invoke('library:addFolder'),
  toggleFavorite: (id) => ipcRenderer.invoke('favorite:toggle', id),
  removeSong: (id) => ipcRenderer.invoke('song:remove', id),
  recordListen: (songId, seconds, play) => ipcRenderer.invoke('stats:record', songId, seconds, play),
  getListenStats: () => ipcRenderer.invoke('stats:get'),
  listPlaylists: () => ipcRenderer.invoke('playlist:list'),
  createPlaylist: (name) => ipcRenderer.invoke('playlist:create', name),
  addToPlaylist: (playlistId, songId) => ipcRenderer.invoke('playlist:add', playlistId, songId),
  removeFromPlaylist: (playlistId, songId) => ipcRenderer.invoke('playlist:remove', playlistId, songId),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getLyrics: (song) => ipcRenderer.invoke('lyrics:get', song),
  readFileBuffer: (filePath) => ipcRenderer.invoke('file:readBuffer', filePath),
  getBpm: (id) => ipcRenderer.invoke('bpm:get', id),
  saveBpm: (id, bpm) => ipcRenderer.invoke('bpm:save', id, bpm),
  getDjComment: (song) => ipcRenderer.invoke('dj:comment', song),
  getDjPlan: (cur, next) => ipcRenderer.invoke('dj:plan', cur, next),
  djPick: (text, songs) => ipcRenderer.invoke('dj:pick', text, songs),
  djChat: (text, context) => ipcRenderer.invoke('dj:chat', text, context),
  edgeTts: (text, voice, rate, pitch) => ipcRenderer.invoke('tts:edge', text, voice, rate, pitch),
  onLibraryProgress: (cb) => {
    ipcRenderer.on('library:progress', (_e, data) => cb(data));
    ipcRenderer.on('library:scanned', () => cb({ scanned: true }));
  },
  onMediaKey: (cb) => {
    ipcRenderer.on('media:playpause', () => cb('media:playpause'));
    ipcRenderer.on('media:next', () => cb('media:next'));
    ipcRenderer.on('media:prev', () => cb('media:prev'));
  }
});
