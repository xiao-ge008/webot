try {
    const electron = globalThis.require('electron');
    console.log('globalThis.require Success!');
    console.log('has app:', !!electron.app);
} catch (e) {
    console.log('globalThis.require Failed:', e.message);
}
process.exit(0);
