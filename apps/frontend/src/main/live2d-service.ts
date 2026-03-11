import { dialog } from 'electron';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';

import { ensureSharedWorkspace } from './shared-workspace-manager';
import type {
    ImportLive2dModelResult,
    Live2dModelConfig,
    SaveLive2dConfigInput,
    SaveLive2dConfigResult,
    Live2dMotion,
    Live2dExpression,
} from './types';

async function parseAndCompleteLive2dConfig(
    modelDir: string,
    folderName: string,
    modelJsonFile: string,
): Promise<Live2dModelConfig> {
    const jsonPath = path.join(modelDir, modelJsonFile);
    const content = await fs.readFile(jsonPath, 'utf8');
    const data = JSON.parse(content);

    const motions: Live2dMotion[] = [];
    const expressions: Live2dExpression[] = [];

    // Parse motions
    const rawMotions = data.FileReferences?.Motions || data.motions;
    if (rawMotions && typeof rawMotions === 'object') {
        for (const [group, items] of Object.entries(rawMotions)) {
            if (Array.isArray(items)) {
                items.forEach((item: any, i: number) => {
                    motions.push({
                        group,
                        name: String(i), // store index or specific key
                        file: item.File || item.file || '',
                    });
                });
            } else if (typeof items === 'object' && items !== null) {
                // Just in case it's not an array
                motions.push({
                    group,
                    name: '0',
                    file: (items as any).File || (items as any).file || '',
                });
            }
        }
    }

    // Parse expressions
    const rawExpr = data.FileReferences?.Expressions || data.expressions;
    if (Array.isArray(rawExpr)) {
        rawExpr.forEach((item: any) => {
            expressions.push({
                name: item.Name || item.name || '',
                file: item.File || item.file || '',
            });
        });
    }

    const baseConfig: Live2dModelConfig = {
        id: folderName,
        name: folderName,
        modelJsonFile,
        motions,
        expressions,
    };

    // Merge with custom config if it exists
    const customConfigPath = path.join(modelDir, 'live2d_custom_config.json');
    if (fss.existsSync(customConfigPath)) {
        try {
            const customContent = await fs.readFile(customConfigPath, 'utf8');
            const customData = JSON.parse(customContent);

            if (customData.name) {
                baseConfig.name = customData.name;
            }

            // Update motions with translations
            baseConfig.motions = baseConfig.motions.map((m) => {
                const found = customData.motions?.find(
                    (c: any) => c.group === m.group && c.name === m.name,
                );
                return found
                    ? { ...m, descriptionCh: found.descriptionCh, descriptionEn: found.descriptionEn }
                    : m;
            });

            // Update expressions with translations
            baseConfig.expressions = baseConfig.expressions.map((e) => {
                const found = customData.expressions?.find((c: any) => c.name === e.name);
                return found
                    ? { ...e, descriptionCh: found.descriptionCh, descriptionEn: found.descriptionEn }
                    : e;
            });
        } catch (e) {
            console.error('Failed to parse live2d_custom_config.json', e);
        }
    }

    return baseConfig;
}

export async function importLive2dModel(): Promise<ImportLive2dModelResult> {
    const { filePaths } = await dialog.showOpenDialog({
        title: 'Select Live2D Model Folder',
        properties: ['openDirectory'],
    });

    if (!filePaths || filePaths.length === 0) {
        return { success: false, message: '未选择任何文件夹' };
    }

    const sourceDir = filePaths[0];
    const folderName = path.basename(sourceDir);
    const shared = await ensureSharedWorkspace();
    const targetDir = path.join(shared.sharedModelsRoot, folderName);

    if (fss.existsSync(targetDir)) {
        return { success: false, message: '该模型文件夹已存在' };
    }

    // Check if model json exists before copying
    const files = await fs.readdir(sourceDir);
    const modelJsonFile = files.find(
        (f) => f.endsWith('.model3.json') || f.endsWith('model.json'),
    );

    if (!modelJsonFile) {
        return {
            success: false,
            message: '所选文件夹中未找到 model.json 或 .model3.json',
        };
    }

    try {
        await fs.cp(sourceDir, targetDir, { recursive: true });

        const config = await parseAndCompleteLive2dConfig(targetDir, folderName, modelJsonFile);
        return { success: true, model: config };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function listLive2dModels(): Promise<Live2dModelConfig[]> {
    const shared = await ensureSharedWorkspace();
    const models: Live2dModelConfig[] = [];

    if (!fss.existsSync(shared.sharedModelsRoot)) {
        return [];
    }

    const folders = await fs.readdir(shared.sharedModelsRoot);

    for (const folder of folders) {
        const modelDir = path.join(shared.sharedModelsRoot, folder);
        const stat = await fs.stat(modelDir);
        if (!stat.isDirectory()) continue;

        const files = await fs.readdir(modelDir);
        const modelJsonFile = files.find(
            (f) => f.endsWith('.model3.json') || f.endsWith('model.json'),
        );
        if (!modelJsonFile) continue;

        try {
            const config = await parseAndCompleteLive2dConfig(modelDir, folder, modelJsonFile);
            models.push(config);
        } catch (e) {
            console.error('Failed to parse model', folder, e);
        }
    }

    return models;
}

export async function saveLive2dConfig(
    input: SaveLive2dConfigInput,
): Promise<SaveLive2dConfigResult> {
    try {
        const shared = await ensureSharedWorkspace();
        const modelDir = path.join(shared.sharedModelsRoot, input.modelId);
        if (!fss.existsSync(modelDir)) {
            return { success: false, message: 'Model directory not found' };
        }

        const customConfigPath = path.join(modelDir, 'live2d_custom_config.json');
        const saveData = {
            modelId: input.modelId,
            motions: input.motions,
            expressions: input.expressions,
        };

        await fs.writeFile(customConfigPath, JSON.stringify(saveData, null, 2), 'utf8');
        return { success: true };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function downloadGithubLive2dModel(url: string): Promise<ImportLive2dModelResult> {
    try {
        const match = url.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+)$/);
        if (!match) {
            return { success: false, message: '无效的链接，请提供指向具体模型文件夹的 GitHub 链接 (例如 https://github.com/.../tree/master/model/shizuku)' };
        }

        const [, owner, repo, branch, targetPath] = match;
        const cleanTargetPath = targetPath.replace(/\/$/, '');
        const folderName = cleanTargetPath.split('/').pop() || 'downloaded_model';

        const shared = await ensureSharedWorkspace();
        const targetDir = path.join(shared.sharedModelsRoot, folderName);

        if (fss.existsSync(targetDir)) {
            return { success: false, message: `模型文件夹 ${folderName} 已存在` };
        }

        const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
        const treeRes = await fetch(treeUrl, { headers: { 'User-Agent': 'weBot-App' } });

        if (!treeRes.ok) {
            return { success: false, message: `无法获取 GitHub 仓库信息: HTTP ${treeRes.status}` };
        }

        const treeData = (await treeRes.json()) as any;

        const filesToDownload = treeData.tree.filter((item: any) =>
            item.type === 'blob' && item.path.startsWith(`${cleanTargetPath}/`)
        );

        if (!filesToDownload || filesToDownload.length === 0) {
            return { success: false, message: '未找到该路径下的文件' };
        }

        await fs.mkdir(targetDir, { recursive: true });

        for (const item of filesToDownload) {
            const relativePath = item.path.substring(cleanTargetPath.length + 1);
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`;
            const destPath = path.join(targetDir, relativePath);

            await fs.mkdir(path.dirname(destPath), { recursive: true });

            const fileRes = await fetch(rawUrl);
            if (!fileRes.ok) throw new Error(`无法下载文件: ${relativePath}`);
            const buffer = await fileRes.arrayBuffer();
            await fs.writeFile(destPath, Buffer.from(buffer));
        }

        const downloadedFiles = await fs.readdir(targetDir);
        const modelJsonFile = downloadedFiles.find(f => f.endsWith('.model3.json') || f.endsWith('model.json'));

        if (!modelJsonFile) {
            await fs.rm(targetDir, { recursive: true, force: true });
            return { success: false, message: '所选文件夹中未找到 model.json 或 .model3.json' };
        }

        const config = await parseAndCompleteLive2dConfig(targetDir, folderName, modelJsonFile);
        return { success: true, model: config };
    } catch (error: any) {
        return { success: false, message: error.message || '网络或解析错误' };
    }
}
