const Module = require('module');
try {
    const electron = Module._load('electron', { paths: [] }, false);
    console.log('Module._load success!');
    console.log('type:', typeof electron);
    console.log('has app:', !!electron.app);
} catch (e) {
    console.log('Module._load failed:', e.message);
}
process.exit(0);
