import * as electron from 'electron';
console.log('electron keys:', Object.keys(electron));
const { app, protocol } = electron;
console.log('app:', !!app);
console.log('protocol:', !!protocol);
if (app) {
    app.whenReady().then(() => {
        console.log('App ready');
        app.quit();
    });
} else {
    console.log('app is missing!');
    process.exit(1);
}
