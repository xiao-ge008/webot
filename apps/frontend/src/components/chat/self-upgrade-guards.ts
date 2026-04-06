type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasNonEmptyString(value: unknown): boolean {
  return normalizeText(value).length > 0;
}

function extractPatchFromProposedChanges(
  proposedChanges: unknown,
  kind: 'identity_patch' | 'memory_patch',
): JsonRecord | undefined {
  if (!Array.isArray(proposedChanges)) return undefined;
  for (const item of proposedChanges) {
    if (!isRecord(item)) continue;
    if (normalizeText(item.kind) !== kind) continue;
    if (isRecord(item.payload)) {
      return item.payload;
    }
  }
  return undefined;
}

function identityPatchHasEffectiveChanges(patch: unknown): boolean {
  if (!isRecord(patch)) return false;
  const files = isRecord(patch.files) ? patch.files : undefined;
  const hasFiles = files
    ? Object.values(files).some((value) => hasNonEmptyString(value))
    : false;
  return hasFiles
    || hasNonEmptyString(patch.system_prompt)
    || patch.avatar_url !== undefined
    || patch.color !== undefined;
}

function memoryPatchHasEffectiveChanges(patch: unknown): boolean {
  if (!isRecord(patch)) return false;
  return hasNonEmptyString(patch.content);
}

function resolveReviewRecord(payload: unknown): JsonRecord | undefined {
  if (!isRecord(payload)) return undefined;
  if (isRecord(payload.review)) return payload.review;
  if (hasNonEmptyString(payload.review_id) || hasNonEmptyString(payload.reviewId)) {
    return undefined;
  }
  return payload;
}

export interface SelfUpgradePayloadGuard {
  canConfirm: boolean;
  reason?: string;
  reviewId?: string;
}

export function analyzeSelfUpgradePayload(payload: unknown): SelfUpgradePayloadGuard {
  if (!isRecord(payload)) {
    return {
      canConfirm: false,
      reason: '当前确认卡缺少有效的升级数据，无法继续执行。',
    };
  }

  const reviewId = normalizeText(payload.reviewId) || normalizeText(payload.review_id) || undefined;
  const review = resolveReviewRecord(payload);
  if (!review) {
    if (reviewId) {
      return { canConfirm: true, reviewId };
    }
    return {
      canConfirm: false,
      reviewId,
      reason: '当前确认卡缺少 review_id 或审查详情，无法继续应用这次升级。',
    };
  }

  const identityPatch = isRecord(review.identity_patch)
    ? review.identity_patch
    : extractPatchFromProposedChanges(review.proposed_changes, 'identity_patch');
  const memoryPatch = isRecord(review.memory_patch)
    ? review.memory_patch
    : extractPatchFromProposedChanges(review.proposed_changes, 'memory_patch');

  if (identityPatchHasEffectiveChanges(identityPatch) || memoryPatchHasEffectiveChanges(memoryPatch)) {
    return { canConfirm: true, reviewId };
  }

  return {
    canConfirm: false,
    reviewId,
    reason: '这份升级审查缺少可执行补丁内容，无法确认应用。请重新生成包含身份文件更新或记忆补丁的升级方案。',
  };
}

export function localizeSelfUpgradeErrorMessage(message: string): string {
  const normalized = message.trim();
  if (!normalized) return '自我升级执行失败。';
  if (normalized.includes('my_upgrade_review requires an executable identity_patch or memory_patch payload')) {
    return '这次自我升级只有审查描述，没有可执行补丁内容。请重新生成升级方案，并把最终正文直接放进 identity_patch.files（如 IDENTITY.md、SOUL.md、USER.md）或放进 memory_patch.content。';
  }
  if (normalized.includes('The reviewed upgrade does not contain identity_patch or memory_patch payloads to apply')) {
    return '当前审查记录里没有可应用的身份补丁或记忆补丁，所以这次升级无法落地。请重新生成完整升级内容后再确认。';
  }
  if (normalized.includes('my_identity_patch requires at least one file update, system_prompt, avatar_url, or color')) {
    return '本次身份升级没有携带任何实际修改内容，所以系统无法应用。请补充具体的身份文件更新、系统提示词、头像或颜色改动。';
  }
  if (normalized.includes('my_upgrade_apply requires a review object or a resolvable review_id')) {
    return '当前确认卡缺少可追溯的升级审查记录，无法继续应用。请重新发起一次升级审查。';
  }
  return normalized;
}
