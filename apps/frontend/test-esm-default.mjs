import electron from 'electron';
console.log('electron:', electron);
const { app, protocol } = electron;
console.log('app:', app);
console.log('protocol:', protocol);
app.whenReady().then(() => {
    console.log('App ready');
    app.quit();
});
