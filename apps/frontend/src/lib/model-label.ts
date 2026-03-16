export function formatModelLabel(
  providerId: string,
  modelName: string,
  fallbackDisplayName?: string,
): string {
  const p = (providerId || '').trim();
  const m = (modelName || '').trim();
  const fallback = (fallbackDisplayName || '').trim();

  if (!m) {
    return fallback;
  }

  // 记忆点：
  // 某些 provider（例如 nvidia-nim）模型名本身就是 namespaced 形式（如 "z-ai/glm4.7"、"qwen/qwen3.5-..."）。
  // UI 再拼一个 `${providerId}/` 会造成“阴魂不散的头”，而且还容易误导为 provider/model 二级结构。
  // 因此只要 modelName 自带 `/`，默认直接展示 modelName 本体。
  if (m.includes('/')) {
    return m;
  }

  if (fallback) {
    return fallback;
  }

  if (!p) {
    return m;
  }

  return `${p}/${m}`;
}

export function formatCurrentModelLabel(
  providerId: string,
  modelName: string,
  fallbackDisplayName?: string,
): string {
  const base = formatModelLabel(providerId, modelName, fallbackDisplayName);
  if (!base) {
    return '（当前）';
  }
  return `${base}（当前）`;
}

