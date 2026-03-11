const electron = require('electron');
console.log('require type:', typeof electron);
try {
    const electron2 = process.mainModule.require('electron');
    console.log('process.mainModule.require type:', typeof electron2);
    console.log('has app:', !!electron2.app);
} catch (e) {
    console.log('process.mainModule.require failed');
}
process.exit(0);
