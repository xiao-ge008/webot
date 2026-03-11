import { app, protocol } from 'electron';
console.log('app:', app);
console.log('protocol:', protocol);
app.whenReady().then(() => {
    console.log('App ready');
    app.quit();
});
