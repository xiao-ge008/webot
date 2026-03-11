const Module = require('module');
try {
    // process.execPath is typically the path to electron.exe
    const electron = Module.createRequire(process.execPath)('electron');
    console.log('Success!');
    console.log('has app:', !!electron.app);
} catch (e) {
    console.log('Failed:', e.message);
}
process.exit(0);
