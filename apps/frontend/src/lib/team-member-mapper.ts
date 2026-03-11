import type { AgentTeamMember } from '@/main/types';
import type { TeamMember } from '@/components/settings/TeamMemberConfig';
import { createTeamMemberTools } from '@/components/settings/TeamMemberConfig';

export interface TeamMemberModelOption {
  modelId: string;
  providerId: string;
  modelName: string;
  displayName: string;
}

export function mapProfileTeamMembersToUi(
  members: readonly AgentTeamMember[] | undefined,
  modelOptions: readonly TeamMemberModelOption[],
  fallbackModelId: string,
): TeamMember[] {
  if (!members || members.length === 0) return [];
  const fallbackOption = modelOptions.find((option) => option.modelId === fallbackModelId) ?? modelOptions[0];

  return members.map((member, index) => {
    const matchedModel = modelOptions.find(
      (option) => option.providerId === member.providerId && option.modelName === member.modelName,
    );
    const modelId = matchedModel?.modelId ?? fallbackOption?.modelId ?? fallbackModelId;
    const overrides = Object.fromEntries(
      (member.toolPermissions ?? []).map((item) => [item.id, { name: item.name, enabled: item.enabled }]),
    );

    return {
      id: member.id || `member-${index + 1}`,
      name: member.name || `成员 ${index + 1}`,
      role: member.role || '子智能体',
      avatarUrl: member.avatarUrl,
      systemPrompt: member.systemPrompt || '',
      model: modelId,
      tools: createTeamMemberTools(member.allowedTools, overrides),
    };
  });
}

export function mapUiTeamMembersToProfile(
  members: readonly TeamMember[],
  modelOptions: readonly TeamMemberModelOption[],
  fallbackProviderId: string,
  fallbackModelName: string,
): AgentTeamMember[] {
  return members.map((member, index) => {
    const model = modelOptions.find((option) => option.modelId === member.model);
    const allowedTools = member.tools.filter((item) => item.enabled).map((item) => item.id);
    return {
      id: member.id || `member-${index + 1}`,
      name: member.name?.trim() || `成员 ${index + 1}`,
      role: member.role?.trim() || '子智能体',
      avatarUrl: member.avatarUrl?.trim() || undefined,
      systemPrompt: member.systemPrompt?.trim() || '',
      providerId: model?.providerId || fallbackProviderId,
      modelName: model?.modelName || fallbackModelName,
      allowedTools,
      toolPermissions: member.tools.map((tool) => ({
        id: tool.id,
        name: tool.name,
        enabled: tool.enabled,
      })),
    };
  });
}
