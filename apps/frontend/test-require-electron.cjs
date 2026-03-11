const electron = require('electron');
console.log('type:', typeof electron);
console.log('keys:', Object.keys(electron));
console.log('is string:', typeof electron === 'string');
if (typeof electron !== 'string' && electron.app) {
    console.log('Success!');
} else {
    console.log('Failed! It returned:', electron);
}
process.exit(0);
