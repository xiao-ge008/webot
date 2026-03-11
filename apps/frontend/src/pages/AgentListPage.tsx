import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Search,
  MessageSquare,
  Cpu,
  Plus,
} from 'lucide-react';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import type { Agent, AgentCategory } from '@/types';
import {
  listManagementAgents,
  type ManagementAgentSummary,
} from '@/services/management-client';

const HIDDEN_COLLAB_TAGS = new Set(['webot:collab_discoverable', 'webot:collab_dispatcher']);

function filterCollaborationTags(tags: string[]): string[] {
  return tags.filter((tag) => !HIDDEN_COLLAB_TAGS.has(tag.trim().toLowerCase()));
}

/** 状态 Badge */
function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<string, { labelKey: string; variant: 'success' | 'warning' | 'secondary' }> = {
    online: { labelKey: 'status.online', variant: 'success' },
    busy: { labelKey: 'status.busy', variant: 'warning' },
    offline: { labelKey: 'status.offline', variant: 'secondary' },
  };
  const config = map[status] ?? map.offline;
  return (
    <Badge variant={config.variant} className="text-[10px] px-2 py-0 h-5">
      {t(config.labelKey)}
    </Badge>
  );
}

/** 分类的 key 列表 */
const categoryKeys: AgentCategory[] = ['all', 'development', 'business', 'creative', 'research'];

function mapStateToStatus(state: string): Agent['status'] {
  const normalized = state.trim().toLowerCase();
  if (normalized.includes('busy')) {
    return 'busy';
  }
  if (normalized.includes('run') || normalized.includes('online') || normalized.includes('idle')) {
    return 'online';
  }
  return 'offline';
}

function mapSummaryToAgent(profile: ManagementAgentSummary): Agent {
  const rawTags = Array.isArray(profile.tags) ? profile.tags : [];
  const visibleTags = filterCollaborationTags(rawTags);
  return {
    id: profile.id,
    name: profile.name,
    title: profile.name,
    avatarUrl: profile.identity.avatar_url,
    description: profile.description || 'No description',
    expertise:
      visibleTags.length > 0
        ? visibleTags
        : rawTags.length === 0
          ? ['general']
          : [],
    status: mapStateToStatus(profile.state),
    personality: 'default',
    mcpTools: [],
    model: profile.model.model || 'unknown',
    createdAt: new Date().toISOString(),
    messagesCount: 0,
    color: profile.identity.color || '#64748b',
  };
}

export function AgentListPage() {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<AgentCategory>('all');
  const [searchText, setSearchText] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    const loadAgents = async () => {
      try {
        const profiles = await listManagementAgents();
        setAgents(profiles.map(mapSummaryToAgent));
      } catch (error) {
        console.error('[AgentList] 加载智能体失败:', error);
      }
    };

    void loadAgents();
  }, []);

  const filtered = agents.filter((a) => {
    const matchesCategory = activeCategory === 'all' || a.expertise.includes(activeCategory);
    if (!matchesCategory) return false;
    if (!searchText) return true;
    const keyword = searchText.toLowerCase();
    return (
      a.name.toLowerCase().includes(keyword) ||
      a.title.includes(searchText) ||
      a.description.includes(searchText)
    );
  });

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('agentList.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('agentList.subtitle', { count: agents.length })}
        </p>
      </div>

      {/* 搜索 & 分类筛选 */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t('agentList.searchPlaceholder')}
            className="pl-10 bg-background"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
        <div className="flex gap-1">
          {categoryKeys.map((key) => (
            <Button
              key={key}
              variant={activeCategory === key ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveCategory(key)}
              className="text-sm"
            >
              {t(`category.${key}`)}
            </Button>
          ))}
        </div>
      </div>

      {/* 智能体卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((agent) => (
          <Link key={agent.id} to={`/edit/${agent.id}`}>
            <Card className="h-full hover:bg-muted/50 transition-colors cursor-pointer">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <AgentAvatar
                      name={agent.name}
                      avatarUrl={agent.avatarUrl}
                      color={agent.color}
                      size="default"
                    />
                    <div>
                      <h3 className="font-semibold text-sm">{agent.name}</h3>
                    </div>
                  </div>
                  <StatusBadge status={agent.status} />
                </div>

                <p className="text-sm text-muted-foreground leading-relaxed mb-3 line-clamp-2">
                  {agent.description}
                </p>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  {agent.expertise.slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                      {tag}
                    </Badge>
                  ))}
                  {agent.expertise.length > 3 && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                      +{agent.expertise.length - 3}
                    </Badge>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Cpu className="w-3 h-3" />
                      {agent.model}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" />
                      {agent.messagesCount}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}

        {/* 创建新智能体卡片 */}
        <Link to="/create">
          <Card className="h-full min-h-[180px] flex items-center justify-center border-dashed hover:bg-muted/50 transition-colors cursor-pointer">
            <CardContent className="flex flex-col items-center justify-center py-8">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-3">
                <Plus className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">{t('agentList.createNew')}</p>
              <p className="text-xs text-muted-foreground">{t('agentList.createHint')}</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* 空状态 */}
      {filtered.length === 0 && (
        <Card className="py-12">
          <CardContent className="text-center">
            <p className="text-muted-foreground">{t('agentList.emptyTitle')}</p>
            <p className="text-sm text-muted-foreground mt-1">{t('agentList.emptyDesc')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
