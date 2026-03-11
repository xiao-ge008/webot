try {
    const electron = require('node:electron');
    console.log('node:electron Success!');
    console.log('has app:', !!electron.app);
} catch (e) {
    console.log('node:electron Failed:', e.message);
}
process.exit(0);
