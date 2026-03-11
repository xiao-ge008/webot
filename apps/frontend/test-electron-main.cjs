try {
    const electronMain = require('electron/main');
    console.log('electron/main success!', !!electronMain.app);
} catch (e) {
    console.log('electron/main failed');
}
try {
    const electron = require('electron');
    console.log('electron type:', typeof electron);
} catch (e) {
    console.log('electron failed');
}
process.exit(0);
