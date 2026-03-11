const Module = require('module');
try {
    // Use a path that is guaranteed to not have the local node_modules in its search tree
    const electron = Module.createRequire('C:/')('electron');
    console.log('C:/ require Success!');
    console.log('has app:', !!electron.app);
} catch (e) {
    console.log('C:/ require Failed:', e.message);
}
process.exit(0);
