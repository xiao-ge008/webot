import type {
    ImportLive2dModelResult,
    Live2dModelConfig,
    SaveLive2dConfigInput,
    SaveLive2dConfigResult,
} from '@/main/types';

interface IpcInvoker {
    invoke: (channel: string, payload?: unknown) => Promise<unknown>;
}

function resolveIpcInvoker(): IpcInvoker | null {
    if (typeof window === 'undefined') {
        return null;
    }

    const globalWindow = window as unknown as {
        webotIpc?: IpcInvoker;
        electron?: { ipcRenderer?: IpcInvoker };
    };

    if (globalWindow.webotIpc?.invoke) {
        return globalWindow.webotIpc;
    }

    if (globalWindow.electron?.ipcRenderer?.invoke) {
        return globalWindow.electron.ipcRenderer;
    }

    return null;
}

async function invokeIpc<TResponse>(channel: string, payload?: unknown): Promise<TResponse> {
    const ipc = resolveIpcInvoker();
    if (!ipc) {
        throw new Error('IPC 未就绪');
    }

    return (await ipc.invoke(channel, payload)) as TResponse;
}

function fallbackError<TResponse>(message: string): TResponse {
    throw new Error(message);
}

const CHANNELS = {
    importModel: 'live2d:import-model',
    listModels: 'live2d:list-models',
    saveConfig: 'live2d:save-config',
    downloadGithub: 'live2d:download-github',
};

// ==================== Live2D ====================

export async function importLive2dModel(): Promise<ImportLive2dModelResult> {
    const ipc = resolveIpcInvoker();
    if (!ipc) {
        return { success: false, message: 'IPC 未就绪' };
    }
    return invokeIpc<ImportLive2dModelResult>(CHANNELS.importModel);
}

export async function listLive2dModels(): Promise<Live2dModelConfig[]> {
    const ipc = resolveIpcInvoker();
    if (!ipc) {
        return fallbackError('IPC 未就绪');
    }
    return invokeIpc<Live2dModelConfig[]>(CHANNELS.listModels);
}

export async function saveLive2dConfig(
    input: SaveLive2dConfigInput,
): Promise<SaveLive2dConfigResult> {
    const ipc = resolveIpcInvoker();
    if (!ipc) {
        return { success: false, message: 'IPC 未就绪' };
    }
    return invokeIpc<SaveLive2dConfigResult>(CHANNELS.saveConfig, input);
}

export async function downloadGithubLive2dModel(url: string): Promise<ImportLive2dModelResult> {
    const ipc = resolveIpcInvoker();
    if (!ipc) {
        return { success: false, message: 'IPC 未就绪' };
    }
    return invokeIpc<ImportLive2dModelResult>(CHANNELS.downloadGithub, { url });
}
