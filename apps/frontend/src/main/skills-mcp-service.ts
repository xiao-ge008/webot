import path from 'node:path';
import { cp, readFile, readdir, rm, stat, mkdir, writeFile } from 'node:fs/promises';

import { ensureSharedWorkspace } from './shared-workspace-manager';
import type {
  SkillItem,
  McpServerConfig,
  SkillMetadata,
  SkillImportResult,
  SkillScopeInput,
  McpServerCreateInput,
  McpServerCreateResult,
  McpServerImportInput,
  McpServerImportResult,
  McpServerDeleteResult,
  McpServerScopeInput,
} from './skills-mcp-types';

const SKILL_FILE_CANDIDATES = ['SKILLS.md', 'SKILL.md', 'skills.md', 'skill.md'] as const;

function parseFrontmatter(content: string): Partial<SkillMetadata> | null {
  const match = content.match(/^---\s*([\s\S]*?)\s*---/);
  if (!match) return null;
  const lines = match[1].split('\n');
  const metadata: Partial<SkillMetadata> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const entry = trimmed.match(/^(\w+):\s*(.+)$/);
    if (!entry) continue;
    const [, key, value] = entry;
    if (key === 'name') metadata.name = value;
    if (key === 'description') metadata.description = value;
    if (key === 'location') metadata.location = value;
  }

  return metadata;
}

function parseSkillFileContent(content: string, fallbackName: string, fallbackLocation: string): SkillMetadata {
  const frontmatter = parseFrontmatter(content);
  if (frontmatter?.name && frontmatter?.description) {
    return {
      name: frontmatter.name,
      description: frontmatter.description,
      location: frontmatter.location ?? fallbackLocation,
    };
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const titleLine = lines.find((line) => line.startsWith('#')) ?? lines[0];
  const name = titleLine ? titleLine.replace(/^#+\s*/, '') : fallbackName;
  const description = lines.find((line) => line !== titleLine) ?? '未填写描述';

  return {
    name: name || fallbackName,
    description,
    location: fallbackLocation,
  };
}

async function resolveSkillMetadata(
  folderPath: string,
  folderName: string,
  fallbackLocation: string,
): Promise<SkillMetadata | null> {
  for (const candidate of SKILL_FILE_CANDIDATES) {
    const filePath = path.join(folderPath, candidate);
    try {
      const content = await readFile(filePath, 'utf-8');
      return parseSkillFileContent(content, folderName, fallbackLocation);
    } catch {
      // ignore
    }
  }
  return null;
}

async function ensureDirectory(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    const info = await stat(targetPath);
    return info.isDirectory();
  } catch {
    return false;
  }
}

function createSkillId(folderName: string): string {
  return folderName.trim();
}

function parseSkillId(skillId: string): { folderName: string } {
  const trimmed = skillId.trim();
  const match = trimmed.match(/^(?:app|shared|global|agent):(.+)$/);
  if (match?.[1]) {
    return { folderName: match[1].trim() };
  }
  return { folderName: trimmed };
}

function buildFallbackLocation(folderName: string): string {
  return path.join('skills', folderName);
}

async function resolveSkillsRoot(scope?: SkillScopeInput): Promise<string> {
  const shared = await ensureSharedWorkspace(scope?.homeDirOverride);
  await ensureDirectory(shared.sharedSkillsRoot);
  return shared.sharedSkillsRoot;
}

async function resolveMcpStoragePath(scope?: McpServerScopeInput): Promise<string> {
  const shared = await ensureSharedWorkspace(scope?.homeDirOverride);
  await ensureDirectory(shared.sharedMcpRoot);
  return path.join(shared.sharedMcpRoot, 'servers.json');
}

async function readSkillsFromRoot(skillsRoot: string): Promise<SkillItem[]> {
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const skills: SkillItem[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderName = entry.name;
    const folderPath = path.join(skillsRoot, folderName);
    const metadata = await resolveSkillMetadata(folderPath, folderName, buildFallbackLocation(folderName));
    if (!metadata) continue;
    skills.push({
      id: createSkillId(folderName),
      metadata,
      path: folderPath,
      isSystem: false,
      isNew: false,
    });
  }

  return skills;
}

async function safeReadSkillsFromRoot(skillsRoot: string): Promise<SkillItem[]> {
  try {
    return await readSkillsFromRoot(skillsRoot);
  } catch {
    return [];
  }
}

async function resolveUniqueFolderName(baseName: string, root: string): Promise<string> {
  const normalizedBase = baseName.trim().replace(/[\\/:*?"<>|]/g, '_') || 'skill';
  let candidate = normalizedBase;
  let index = 1;
  while (await isDirectory(path.join(root, candidate))) {
    candidate = `${normalizedBase}-${index}`;
    index += 1;
  }
  return candidate;
}

function slugifyId(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : 'mcp-server';
}

function ensureUniqueId(baseId: string, existing: ReadonlySet<string>): string {
  let candidate = baseId;
  let index = 1;
  while (existing.has(candidate)) {
    candidate = `${baseId}-${index}`;
    index += 1;
  }
  return candidate;
}

function normalizeMcpType(type?: string): McpServerConfig['type'] {
  if (type === 'sse' || type === 'streamableHttp' || type === 'stdio') {
    return type;
  }
  return 'stdio';
}

function toSafeRecord(input?: Record<string, string>): Record<string, string> | undefined {
  if (!input) return undefined;
  const entries = Object.entries(input).filter(
    ([key, value]) => key.trim().length > 0 && value.trim().length > 0,
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function normalizeMcpInput(input: McpServerCreateInput): Omit<McpServerConfig, 'id'> {
  const name = input.name.trim();

  return {
    name: name.length > 0 ? name : 'MCP Server',
    description: input.description?.trim() || undefined,
    type: normalizeMcpType(input.type),
    enabled: input.enabled ?? true,
    path: input.path?.trim() || undefined,
    command: input.command?.trim() || undefined,
    args: input.args?.filter((item) => item.trim().length > 0),
    env: toSafeRecord(input.env),
    url: input.url?.trim() || undefined,
    headers: toSafeRecord(input.headers),
    longRunning: input.longRunning,
    timeout: typeof input.timeout === 'number' && Number.isFinite(input.timeout) ? input.timeout : undefined,
  };
}

async function readMcpServers(scope?: McpServerScopeInput): Promise<McpServerConfig[]> {
  const storagePath = await resolveMcpStoragePath(scope);
  try {
    const raw = await readFile(storagePath, 'utf-8');
    const payload = JSON.parse(raw) as unknown;
    if (Array.isArray(payload)) {
      return payload.filter((item): item is McpServerConfig => typeof item === 'object' && item !== null);
    }
    return [];
  } catch {
    return [];
  }
}

async function writeMcpServers(scope: McpServerScopeInput, servers: McpServerConfig[]): Promise<boolean> {
  const storagePath = await resolveMcpStoragePath(scope);
  await writeFile(storagePath, JSON.stringify(servers, null, 2), 'utf-8');
  return true;
}

function parseMcpImportPayload(input: McpServerImportInput): McpServerCreateInput[] {
  const raw = input.json.trim();
  if (!raw) return [];
  const payload = JSON.parse(raw) as unknown;

  if (Array.isArray(payload)) {
    return payload.filter((item): item is McpServerCreateInput => typeof item === 'object' && item !== null);
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const maybeArray = record.servers ?? record.mcpServers ?? record.items;
    if (Array.isArray(maybeArray)) {
      return maybeArray.filter((item): item is McpServerCreateInput => typeof item === 'object' && item !== null);
    }
    return [record as unknown as McpServerCreateInput];
  }

  return [];
}

// ==================== Skills 服务 ====================

export async function getAllSkills(scope?: SkillScopeInput): Promise<SkillItem[]> {
  const skillsRoot = await resolveSkillsRoot(scope);
  const skills = await safeReadSkillsFromRoot(skillsRoot);
  return skills.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
}

export async function deleteSkill(
  skillId: string,
  scope?: SkillScopeInput,
): Promise<{ success: boolean; message?: string }> {
  const skillsRoot = await resolveSkillsRoot(scope);

  const { folderName } = parseSkillId(skillId);
  const targetPath = path.join(skillsRoot, folderName);

  if (!(await isDirectory(targetPath))) {
    return { success: false, message: `技能 "${folderName}" 不存在` };
  }

  await rm(targetPath, { recursive: true, force: true });
  return { success: true, message: `技能 "${folderName}" 已删除` };
}

export async function importSkillFromFolder(
  sourcePath: string,
  scope?: SkillScopeInput,
): Promise<SkillImportResult> {
  const skillsRoot = await resolveSkillsRoot(scope);

  const folderName = path.basename(sourcePath);
  const targetName = await resolveUniqueFolderName(folderName, skillsRoot);
  const targetPath = path.join(skillsRoot, targetName);

  await cp(sourcePath, targetPath, { recursive: true });
  const metadata = await resolveSkillMetadata(targetPath, targetName, buildFallbackLocation(targetName));

  return {
    success: true,
    message: '导入成功',
    skill: metadata
      ? {
          id: createSkillId(targetName),
          metadata,
          path: targetPath,
          isSystem: false,
          isNew: true,
        }
      : undefined,
  };
}

// ==================== MCP 服务 ====================

export async function getAllMcpServers(scope?: McpServerScopeInput): Promise<McpServerConfig[]> {
  return await readMcpServers(scope);
}

export async function updateMcpServerState(
  serverId: string,
  updates: Partial<McpServerConfig>,
  scope?: McpServerScopeInput,
): Promise<{ success: boolean; message?: string }> {
  const servers = await readMcpServers(scope);
  const targetIndex = servers.findIndex((item) => item.id === serverId);
  if (targetIndex < 0) {
    return { success: false, message: `MCP 服务器 "${serverId}" 不存在` };
  }

  const current = servers[targetIndex];
  const updated: McpServerConfig = {
    ...current,
    ...updates,
    type: updates.type ? normalizeMcpType(updates.type) : current.type,
    name: updates.name?.trim() || current.name,
  };
  servers[targetIndex] = updated;
  const written = await writeMcpServers(scope ?? {}, servers);
  if (!written) {
    return { success: false, message: '保存 MCP 配置失败。' };
  }

  return { success: true, message: '更新成功' };
}

export async function createMcpServer(
  input: McpServerCreateInput,
  scope?: McpServerScopeInput,
): Promise<McpServerCreateResult> {
  const normalized = normalizeMcpInput(input);
  if (!normalized.name) {
    return { success: false, message: '名称不能为空' };
  }

  const servers = await readMcpServers(scope);
  const existing = new Set(servers.map((item) => item.id));
  const baseId = slugifyId(normalized.name);
  const id = ensureUniqueId(baseId, existing);

  const server: McpServerConfig = {
    id,
    ...normalized,
  };

  servers.push(server);
  const written = await writeMcpServers(scope ?? {}, servers);
  if (!written) {
    return { success: false, message: '保存 MCP 配置失败。' };
  }

  return { success: true, server };
}

export async function deleteMcpServer(
  serverId: string,
  scope?: McpServerScopeInput,
): Promise<McpServerDeleteResult> {
  const servers = await readMcpServers(scope);
  const next = servers.filter((item) => item.id !== serverId);
  if (next.length === servers.length) {
    return { success: false, message: `MCP 服务器 "${serverId}" 不存在` };
  }
  const written = await writeMcpServers(scope ?? {}, next);
  if (!written) {
    return { success: false, message: '保存 MCP 配置失败。' };
  }
  return { success: true };
}

export async function importMcpServers(
  input: McpServerImportInput,
  scope?: McpServerScopeInput,
): Promise<McpServerImportResult> {
  try {
    const incoming = parseMcpImportPayload(input);
    if (incoming.length === 0) {
      return { success: false, message: '未解析到有效的 MCP 配置' };
    }

    const servers = await readMcpServers(scope);
    const existing = new Set(servers.map((item) => item.id));
    let count = 0;

    for (const entry of incoming) {
      const normalized = normalizeMcpInput(entry);
      const baseId = slugifyId(normalized.name);
      const id = ensureUniqueId(baseId, existing);
      existing.add(id);
      servers.push({
        id,
        ...normalized,
      });
      count += 1;
    }

    const written = await writeMcpServers(scope ?? {}, servers);
    if (!written) {
      return { success: false, message: '保存 MCP 配置失败。' };
    }
    return { success: true, count };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : '导入失败' };
  }
}
