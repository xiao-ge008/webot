const Module = require('module');
try {
    const dummy = new Module('dummy');
    dummy.paths = [];
    const electron = dummy.require('electron');
    console.log('Dummy require Success!');
    console.log('has app:', !!electron.app);
} catch (e) {
    console.log('Dummy require Failed:', e.message);
}
process.exit(0);
