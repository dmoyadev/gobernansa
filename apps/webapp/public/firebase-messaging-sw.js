// Notifications now arrive through sw.js. Devices that turned them on before still have this worker registered
// (Firebase's own scope) and keep their token, so it shows them the same way until they turn them on again
globalThis.importScripts('/sw.js');
