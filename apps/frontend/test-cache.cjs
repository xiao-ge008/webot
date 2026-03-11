const Module = require('module');
if (Module._cache['electron']) {
    console.log('Found electron in cache!');
    console.log('has app:', !!Module._cache['electron'].exports.app);
} else {
    console.log('Electron NOT in cache');
    console.log('Cache keys:', Object.keys(Module._cache));
}
process.exit(0);
