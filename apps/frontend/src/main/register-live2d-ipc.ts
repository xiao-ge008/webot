import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { LIVE2D_IPC_CHANNELS } from './ipc-contract';
import {
    importLive2dModel,
    listLive2dModels,
    saveLive2dConfig,
    downloadGithubLive2dModel
} from './live2d-service';
import type { SaveLive2dConfigInput } from './types';

export function registerLive2dIpcHandlers() {
    ipcMain.handle(LIVE2D_IPC_CHANNELS.importModel, async () => {
        return await importLive2dModel();
    });

    ipcMain.handle(LIVE2D_IPC_CHANNELS.listModels, async () => {
        return await listLive2dModels();
    });

    ipcMain.handle(LIVE2D_IPC_CHANNELS.saveConfig, async (_event: IpcMainInvokeEvent, payload: SaveLive2dConfigInput) => {
        return await saveLive2dConfig(payload);
    });

    ipcMain.handle(LIVE2D_IPC_CHANNELS.downloadGithub, async (_event: IpcMainInvokeEvent, payload: { url: string }) => {
        return await downloadGithubLive2dModel(payload.url);
    });
}
