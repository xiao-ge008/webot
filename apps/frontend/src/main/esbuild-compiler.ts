import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { getAllSkills } from './skills-mcp-service';

/**
 * Recursively search for a React component file (.tsx) matching the componentName inside a dir.
 */
async function findComponentInDir(dir: string, componentName: string): Promise<string | null> {
    try {
        const { readdir } = await import('node:fs/promises');
        const entries = await readdir(dir, { withFileTypes: true });

        // console.log(`[SkillProtocol] Searching in ${dir} for "${componentName}" (${entries.length} entries)`);

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const found = await findComponentInDir(fullPath, componentName);
                if (found) return found;
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name);
                const base = path.basename(entry.name, ext);

                // Case-insensitive match for the component name as a filename
                if ((base.toLowerCase() === componentName.toLowerCase()) && (ext === '.tsx' || ext === '.jsx')) {
                    return fullPath;
                }

                // Match index.tsx if the parent folder matches the component name
                if ((entry.name.toLowerCase() === 'index.tsx' || entry.name.toLowerCase() === 'index.jsx') &&
                    path.basename(dir).toLowerCase() === componentName.toLowerCase()) {
                    return fullPath;
                }
            }
        }
        return null;
    } catch (e) {
        console.error(`[SkillProtocol] findComponentInDir Error in ${dir}:`, e);
        return null;
    }
}

/**
 * Resolves a component name (e.g. 'CustomChart') to its absolute file path by scanning all loaded skills.
 */
async function resolveComponentPath(componentName: string, agentId?: string): Promise<string | null> {
    const skills = await getAllSkills(agentId ? { agentId } : undefined);
    console.log(`[SkillProtocol] Resolving "${componentName}" among ${skills.length} skills`);

    for (const skill of skills) {
        // Look inside the skill folder
        const found = await findComponentInDir(skill.path, componentName);
        if (found) {
            console.log(`[SkillProtocol] Found "${componentName}" at ${found}`);
            return found;
        }
    }
    return null;
}

let requestCounter = 0;

export async function handleSkillRequest(request: Request): Promise<Response> {
    const rid = ++requestCounter;
    console.log(`[SkillProtocol][#${rid}] <---- Incoming Request: ${request.url}`);
    try {
        // URL format: skill://ComponentName or skill://GroupName/ComponentName
        const url = new URL(request.url);
        console.log(`[SkillProtocol][#${rid}] Parsing: Host="${url.hostname}", Path="${url.pathname}"`);
        const agentId = url.searchParams.get('agentId')?.trim();

        // Combine hostname and pathname, then clean up slashes
        let componentName = (url.hostname + url.pathname).replace(/^\/|\/$/g, '');

        // Strip common suffixes that might be added by the browser or bundler
        componentName = componentName
            .replace(/\/main\.js$/, '')
            .replace(/\/index\.js$/, '')
            .replace(/\.(js|jsx|ts|tsx)$/, '');

        console.log(`[SkillProtocol][#${rid}] Targeted component identifier: "${componentName}"`);

        if (!componentName) {
            return new Response('Missing component name', { status: 400 });
        }

        const filePath = await resolveComponentPath(componentName, agentId);

        if (!filePath) {
            console.error(`[SkillProtocol][#${rid}] Component "${componentName}" not found in any skill.`);
            return new Response(`Component ${componentName} not found`, { status: 404 });
        }

        console.log(`[SkillProtocol][#${rid}] Compiling ${componentName} from ${filePath}`);

        // 使用 bundle 生成“自包含 ESM”，避免 skill:// 动态模块中的裸导入
        // （如 react/jsx-runtime）在自定义协议下解析失败。
        const buildResult = await esbuild.build({
            entryPoints: [filePath],
            bundle: true,
            write: false,
            platform: 'browser',
            format: 'esm',
            target: 'esnext',
            sourcemap: 'inline',
            logLevel: 'silent',
            loader: {
                '.ts': 'ts',
                '.tsx': 'tsx',
                '.js': 'js',
                '.jsx': 'jsx',
                '.json': 'json',
            },
        });
        const output = buildResult.outputFiles?.[0];
        if (!output) {
            throw new Error('skill 编译失败：未生成输出文件');
        }
        const code = output.text;

        console.log(`[SkillProtocol][#${rid}] Compilation successful for ${componentName}`);
        console.log(`[SkillProtocol][#${rid}] First 200 chars of code:\n${code.substring(0, 200)}...`);

        // Add standard CORS headers just in case
        return new Response(code, {
            status: 200,
            headers: {
                'Content-Type': 'application/javascript',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (error: unknown) {
        console.error(`[SkillProtocol][#${rid}] Compilation error for ${request.url}:`, error);
        return new Response(`Compilation Error: ${(error as Error)?.message || String(error)}`, { status: 500 });
    }
}
