export type HandSettingType = 'select' | 'text' | 'toggle';

export interface HandRequirementInstall {
  windows?: string;
  macos?: string;
  linux_apt?: string;
  linux_dnf?: string;
  linux_pacman?: string;
  pip?: string;
}

export interface HandRequirement {
  key: string;
  label: string;
  satisfied: boolean;
  type?: string;
  description?: string;
  check_value?: string;
  install?: HandRequirementInstall;
}

export interface HandSettingOption {
  value: string;
  label: string;
  provider_env?: string;
  binary?: string;
  available?: boolean;
}

export interface HandSettingStatus {
  key: string;
  label: string;
  description?: string;
  setting_type: HandSettingType;
  default?: string;
  options?: HandSettingOption[];
}

export interface HandDashboardMetric {
  label: string;
  memory_key: string;
  format?: string;
}

export interface HandAgentInfo {
  name: string;
  description?: string;
  provider?: string;
  model?: string;
}

export interface HandDefinitionSummary {
  id: string;
  name: string;
  description?: string;
  category?: string;
  icon?: string;
  tools?: string[];
  requirements_met?: boolean;
  requirements?: HandRequirement[];
  dashboard_metrics?: number;
  has_settings?: boolean;
  settings_count?: number;
}

export interface HandDefinitionDetail extends HandDefinitionSummary {
  server_platform?: string;
  agent?: HandAgentInfo;
  dashboard?: HandDashboardMetric[];
  settings?: HandSettingStatus[];
}

export interface HandInstance {
  instance_id: string;
  hand_id: string;
  status: string;
  agent_id?: string | null;
  agent_name?: string | null;
  activated_at?: string;
  updated_at?: string;
}

export interface HandInstallResult {
  key: string;
  status: string;
  message?: string;
}

export interface HandInstallResponse {
  results: HandInstallResult[];
  requirements?: HandRequirement[];
  requirements_met?: boolean;
}

export interface HandStatsMetric {
  value: string | number | null;
  format?: string;
}

export interface HandStatsResponse {
  metrics?: Record<string, HandStatsMetric>;
}

export interface HandBrowserState {
  active: boolean;
  url?: string;
  title?: string;
  screenshot_base64?: string;
  content?: string;
}

export interface HandChatMessage {
  role: 'user' | 'assistant' | 'system' | 'unknown';
  content: string;
}
