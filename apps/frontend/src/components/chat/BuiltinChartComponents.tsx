import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type ChartKind = 'pie' | 'bar' | 'line' | 'area' | 'radar';

interface SeriesItem {
  key: string;
  label: string;
  color: string;
}

const CHART_COLORS = [
  '#2563eb',
  '#f97316',
  '#22c55e',
  '#a855f7',
  '#06b6d4',
  '#ef4444',
  '#84cc16',
  '#14b8a6',
  '#f59e0b',
  '#6366f1',
];

function toSafeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toNumberLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickColor(index: number, fallback?: string): string {
  if (fallback && fallback.trim()) return fallback.trim();
  return CHART_COLORS[index % CHART_COLORS.length];
}

function toRecordList(input: unknown): Record<string, unknown>[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as Record<string, unknown>);
}

function normalizeChartJsLikeCartesianProps(props: Record<string, unknown>): Record<string, unknown> {
  const rawData = props.data;
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
    return props;
  }

  const dataObject = rawData as Record<string, unknown>;
  const labels = Array.isArray(dataObject.labels) ? dataObject.labels : [];
  const datasets = Array.isArray(dataObject.datasets) ? dataObject.datasets : [];
  if (labels.length === 0 || datasets.length === 0) {
    return props;
  }

  const xKey = toSafeText(props.xKey, 'label') || 'label';
  const rows = labels.map((label, index) => {
    const row: Record<string, unknown> = {
      [xKey]: typeof label === 'string' ? label : String(label ?? ''),
    };
    datasets.forEach((dataset, datasetIndex) => {
      if (!dataset || typeof dataset !== 'object') return;
      const ds = dataset as Record<string, unknown>;
      const values = Array.isArray(ds.data) ? ds.data : [];
      const key = toSafeText(ds.key)
        || toSafeText(ds.dataKey)
        || `series_${datasetIndex + 1}`;
      row[key] = values[index] ?? null;
    });
    return row;
  });

  const series = datasets.map((dataset, datasetIndex) => {
    const ds = dataset as Record<string, unknown>;
    const key = toSafeText(ds.key)
      || toSafeText(ds.dataKey)
      || `series_${datasetIndex + 1}`;
    return {
      key,
      label: toSafeText(ds.label, key) || key,
      color: toSafeText(ds.borderColor) || toSafeText(ds.backgroundColor) || pickColor(datasetIndex),
    };
  });

  return {
    ...props,
    xKey,
    data: rows,
    series,
  };
}

function normalizeSeries(
  props: Record<string, unknown>,
  data: Record<string, unknown>[],
  xKey: string,
): SeriesItem[] {
  const rawSeries = Array.isArray(props.series) ? props.series : [];
  const fromProps = rawSeries
    .map((entry, index): SeriesItem | null => {
      if (typeof entry === 'string') {
        const key = entry.trim();
        if (!key) return null;
        return {
          key,
          label: key,
          color: pickColor(index),
        };
      }
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as Record<string, unknown>;
      const key = toSafeText(row.key) || toSafeText(row.dataKey) || toSafeText(row.name);
      if (!key) return null;
      return {
        key,
        label: toSafeText(row.label) || toSafeText(row.name) || key,
        color: pickColor(index, toSafeText(row.color)),
      };
    })
    .filter((item): item is SeriesItem => Boolean(item));
  if (fromProps.length > 0) return fromProps;

  const sample = data[0] || {};
  const autoKeys = Object.keys(sample).filter((key) => {
    if (key === xKey) return false;
    return toNumberLike(sample[key]) != null;
  });
  return autoKeys.map((key, index) => ({
    key,
    label: key,
    color: pickColor(index),
  }));
}

function normalizeCartesianData(props: Record<string, unknown>): {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesItem[];
} {
  const normalizedProps = normalizeChartJsLikeCartesianProps(props);
  const data = toRecordList(normalizedProps.data ?? normalizedProps.items ?? normalizedProps.rows);
  if (data.length === 0) {
    return { data: [], xKey: 'name', series: [] };
  }

  const sample = data[0] || {};
  const xKey = toSafeText(normalizedProps.xKey)
    || toSafeText(normalizedProps.categoryKey)
    || (Object.keys(sample).find((key) => toNumberLike(sample[key]) == null) || 'name');
  const series = normalizeSeries(normalizedProps, data, xKey);
  return { data, xKey, series };
}

function normalizePieData(props: Record<string, unknown>): Array<{
  name: string;
  value: number;
  color: string;
}> {
  const data = toRecordList(props.data ?? props.items ?? props.values);
  const dataKey = toSafeText(props.dataKey, 'value') || 'value';
  const nameKey = toSafeText(props.nameKey, 'name') || 'name';
  const maxItems = clamp(toNumber(props.maxItems, 12), 1, 40);

  return data
    .map((entry, index) => {
      const value = toNumberLike(entry[dataKey]);
      if (value == null) return null;
      const name = toSafeText(entry[nameKey])
        || toSafeText(entry.label)
        || toSafeText(entry.title)
        || `项 ${index + 1}`;
      return {
        name,
        value,
        color: pickColor(index, toSafeText(entry.color)),
      };
    })
    .filter((row): row is { name: string; value: number; color: string } => Boolean(row))
    .slice(0, maxItems);
}

function renderChart(kind: ChartKind, props: Record<string, unknown>) {
  const height = clamp(toNumber(props.height, 280), 180, 560);
  const showLegend = props.showLegend !== false;
  const showGrid = props.showGrid !== false;
  const compact = props.compact === true;

  if (kind === 'pie') {
    const data = normalizePieData(props);
    if (data.length === 0) {
      return <ChartEmptyState title="PieChartCard 未收到有效数据，请传入 props.data。" />;
    }
    const innerRadius = clamp(toNumber(props.innerRadius, props.donut ? 58 : 0), 0, 120);
    const outerRadius = clamp(toNumber(props.outerRadius, 96), 40, 160);

    return (
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip />
            {showLegend ? <Legend /> : null}
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              label={!compact}
              isAnimationActive
            >
              {data.map((entry, index) => (
                <Cell key={`${entry.name}-${index}`} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const { data, xKey, series } = normalizeCartesianData(props);
  if (data.length === 0 || series.length === 0) {
    return <ChartEmptyState title="图表未收到有效数据，请传入 props.data 与数值字段。" />;
  }

  if (kind === 'bar') {
    return (
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            {showGrid ? <CartesianGrid strokeDasharray="3 3" /> : null}
            <XAxis dataKey={xKey} />
            <YAxis />
            <Tooltip />
            {showLegend ? <Legend /> : null}
            {series.map((item) => (
              <Bar key={item.key} dataKey={item.key} name={item.label} fill={item.color} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (kind === 'area') {
    return (
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            {showGrid ? <CartesianGrid strokeDasharray="3 3" /> : null}
            <XAxis dataKey={xKey} />
            <YAxis />
            <Tooltip />
            {showLegend ? <Legend /> : null}
            {series.map((item) => (
              <Area
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.label}
                stroke={item.color}
                fill={item.color}
                fillOpacity={0.22}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (kind === 'radar') {
    const radarKey = series[0]?.key;
    if (!radarKey) {
      return <ChartEmptyState title="RadarChartCard 未找到可用数值字段。" />;
    }
    return (
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data}>
            <PolarGrid />
            <PolarAngleAxis dataKey={xKey} />
            <PolarRadiusAxis />
            <Tooltip />
            {showLegend ? <Legend /> : null}
            {series.map((item) => (
              <Radar
                key={item.key}
                dataKey={item.key}
                name={item.label}
                stroke={item.color}
                fill={item.color}
                fillOpacity={0.22}
                strokeWidth={2}
              />
            ))}
          </RadarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          {showGrid ? <CartesianGrid strokeDasharray="3 3" /> : null}
          <XAxis dataKey={xKey} />
          <YAxis />
          <Tooltip />
          {showLegend ? <Legend /> : null}
          {series.map((item) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={item.color}
              strokeWidth={2.2}
              dot={compact ? false : { r: 3 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartEmptyState({ title }: { title: string }) {
  return (
    <div className="w-full rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
      {title}
    </div>
  );
}

function getProps(ctx: unknown): Record<string, unknown> {
  if (!ctx || typeof ctx !== 'object') return {};
  const row = ctx as { props?: unknown };
  return row.props && typeof row.props === 'object'
    ? row.props as Record<string, unknown>
    : {};
}

function ChartCardShell({
  kind,
  titleDefault,
  props,
}: {
  kind: ChartKind;
  titleDefault: string;
  props: Record<string, unknown>;
}) {
  const title = toSafeText(props.title, titleDefault) || titleDefault;
  const description = toSafeText(props.description) || toSafeText(props.subtitle);
  const footer = toSafeText(props.footer);
  const badge = toSafeText(props.badge) || kind.toUpperCase();
  const compact = props.compact === true;

  return (
    <Card className="w-full border-border/60 bg-card/45 shadow-none overflow-hidden">
      <CardHeader className={cn('pb-2', compact ? 'pt-3 px-3' : 'pt-4 px-4')}>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className={cn('font-semibold tracking-tight', compact ? 'text-sm' : 'text-base')}>
            {title}
          </CardTitle>
          <Badge variant="secondary" className="text-[10px] h-5 px-2">
            {badge}
          </Badge>
        </div>
        {description ? <p className="text-xs text-muted-foreground mt-1">{description}</p> : null}
      </CardHeader>
      <CardContent className={cn(compact ? 'px-2 pb-2' : 'px-3 pb-3')}>
        {renderChart(kind, props)}
        {footer ? <p className="mt-2 text-[11px] text-muted-foreground">{footer}</p> : null}
      </CardContent>
    </Card>
  );
}

export function GenUIChartCard(ctx: unknown) {
  const props = getProps(ctx);
  const kindRaw = toSafeText(props.chartType || props.type || props.kind, 'line').toLowerCase();
  const kind: ChartKind =
    kindRaw === 'pie' || kindRaw === 'bar' || kindRaw === 'line' || kindRaw === 'area' || kindRaw === 'radar'
      ? kindRaw
      : 'line';
  const titleDefaultMap: Record<ChartKind, string> = {
    pie: '数据占比图',
    bar: '数据柱状图',
    line: '数据趋势图',
    area: '数据面积图',
    radar: '数据雷达图',
  };
  return <ChartCardShell kind={kind} titleDefault={titleDefaultMap[kind]} props={props} />;
}

export function GenUIPieChartCard(ctx: unknown) {
  return <ChartCardShell kind="pie" titleDefault="数据占比图" props={getProps(ctx)} />;
}

export function GenUIBarChartCard(ctx: unknown) {
  return <ChartCardShell kind="bar" titleDefault="数据柱状图" props={getProps(ctx)} />;
}

export function GenUILineChartCard(ctx: unknown) {
  return <ChartCardShell kind="line" titleDefault="数据趋势图" props={getProps(ctx)} />;
}

export function GenUIAreaChartCard(ctx: unknown) {
  return <ChartCardShell kind="area" titleDefault="数据面积图" props={getProps(ctx)} />;
}

export function GenUIRadarChartCard(ctx: unknown) {
  return <ChartCardShell kind="radar" titleDefault="数据雷达图" props={getProps(ctx)} />;
}
