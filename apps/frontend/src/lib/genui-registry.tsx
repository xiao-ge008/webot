import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { GenUIComponentImageCard, GenUIImageAlbum, GenUIImageCarousel, GenUIImageCover } from '@/components/chat/BuiltinImageComponents';
import { GenUIComponentVideoCard, GenUIVideoCarousel, GenUIVideoCover, GenUIVideoGallery } from '@/components/chat/BuiltinVideoComponents';
import { GenUIWebViewCard } from '@/components/chat/BuiltinWebViewComponents';
import { GenUIAudioPlayer, GenUIAudioPlaylist } from '@/components/chat/BuiltinAudioComponents';
import { GenUIMarkdownPreviewCard } from '@/components/chat/BuiltinMarkdownPreviewComponents';
import { GenUIOfficePreviewCard } from '@/components/chat/BuiltinOfficePreviewComponents';
import { GenUIOptionSelector } from '@/components/chat/BuiltinOptionComponents';
import { GenUIAgentManagementConfirmCard } from '@/components/chat/AgentManagementConfirmCard';
import { GenUIGroupUpgradeCard } from '@/components/chat/GroupUpgradeCard';
import {
    GenUIAreaChartCard,
    GenUIBarChartCard,
    GenUIChartCard,
    GenUILineChartCard,
    GenUIPieChartCard,
    GenUIRadarChartCard,
} from '@/components/chat/BuiltinChartComponents';

// Explicit adapter components to avoid name collisions and satisfy lints
const resolveSlot = (props: any, children: any) =>
    children ?? props?.children ?? props?.content ?? props?.text ?? props?.label;
const stripContentProp = (props: any) => {
    if (!props || typeof props !== 'object') return props;
    const { content, ...rest } = props;
    return rest;
};

const flatCardClass = 'border-0 shadow-none';
const GenUICard = ({ props, children }: any) => (
    <Card
        {...stripContentProp(props)}
        className={cn(props?.className, flatCardClass)}
    >
        {resolveSlot(props, children)}
    </Card>
);
const GenUICardHeader = ({ props, children }: any) => (
    <CardHeader {...stripContentProp(props)}>{resolveSlot(props, children)}</CardHeader>
);
const GenUICardTitle = ({ props, children }: any) => (
    <CardTitle {...stripContentProp(props)}>{resolveSlot(props, children)}</CardTitle>
);
const GenUICardDescription = ({ props, children }: any) => (
    <CardDescription {...stripContentProp(props)}>{resolveSlot(props, children)}</CardDescription>
);
const GenUICardContent = ({ props, children }: any) => (
    <CardContent {...stripContentProp(props)}>{resolveSlot(props, children)}</CardContent>
);
const GenUICardFooter = ({ props, children }: any) => (
    <CardFooter {...stripContentProp(props)}>{resolveSlot(props, children)}</CardFooter>
);
const GenUIButton = ({ props, children, emit }: any) => (
    <Button {...stripContentProp(props)} onClick={() => (emit && emit('press')) || props.onClick?.()}>
        {resolveSlot(props, children)}
    </Button>
);
const GenUIBadge = ({ props, children }: any) => (
    <Badge {...stripContentProp(props)} className={cn(props?.className, 'border-0 shadow-none')}>
        {resolveSlot(props, children)}
    </Badge>
);
const GenUIInput = ({ props }: any) => <Input {...stripContentProp(props)} />;
const GenUILabel = ({ props, children }: any) => <Label {...stripContentProp(props)}>{resolveSlot(props, children)}</Label>;
const GenUISeparator = ({ props }: any) => <Separator {...stripContentProp(props)} />;
const GenUIPre = ({ props, children }: any) => <pre {...stripContentProp(props)}>{resolveSlot(props, children)}</pre>;
const GenUICode = ({ props, children }: any) => <code {...stripContentProp(props)}>{resolveSlot(props, children)}</code>;
const GenUIScrollArea = ({ props, children }: any) => (
    <ScrollArea {...stripContentProp(props)}>{resolveSlot(props, children)}</ScrollArea>
);
const GenUITabsList = ({ props, children }: any) => (
    <TabsList {...stripContentProp(props)}>{resolveSlot(props, children)}</TabsList>
);
const GenUITabsTrigger = ({ props, children }: any) => (
    <TabsTrigger {...stripContentProp(props)}>{resolveSlot(props, children)}</TabsTrigger>
);
const GenUITabsContent = ({ props, children }: any) => (
    <TabsContent {...stripContentProp(props)}>{resolveSlot(props, children)}</TabsContent>
);
// Map component types from JSON to our local Shadcn components
// @json-render/react's ComponentFn signature is (ctx: { props, children, ... }) => ReactNode
const GenUISpan = ({ props, children }: any) => <span {...stripContentProp(props)}>{resolveSlot(props, children)}</span>;
const GenUIP = ({ props, children }: any) => <p {...stripContentProp(props)}>{resolveSlot(props, children)}</p>;
const GenUIH1 = ({ props, children }: any) => <h1 {...stripContentProp(props)}>{resolveSlot(props, children)}</h1>;
const GenUIH2 = ({ props, children }: any) => <h2 {...stripContentProp(props)}>{resolveSlot(props, children)}</h2>;
const GenUIH3 = ({ props, children }: any) => <h3 {...stripContentProp(props)}>{resolveSlot(props, children)}</h3>;
const GenUIH4 = ({ props, children }: any) => <h4 {...stripContentProp(props)}>{resolveSlot(props, children)}</h4>;
const GenUIText = ({ props, children }: any) => <p {...stripContentProp(props)}>{resolveSlot(props, children)}</p>;
const GenUIStack = ({ props, children }: any) => {
    const direction = props?.direction === 'row' ? 'row' : 'column';
    const spacingMap: Record<string, string> = {
        none: '0',
        xs: '0.25rem',
        sm: '0.5rem',
        md: '0.75rem',
        lg: '1rem',
        xl: '1.5rem',
    };
    const gap = typeof props?.spacing === 'string'
        ? (spacingMap[props.spacing] ?? props.spacing)
        : undefined;
    const nextProps = {
        ...stripContentProp(props),
        className: cn('flex w-full', direction === 'row' ? 'flex-row' : 'flex-col', props?.className),
        style: {
            ...(props?.style && typeof props.style === 'object' ? props.style : {}),
            ...(gap ? { gap } : {}),
        },
    };
    return <div {...nextProps}>{resolveSlot(props, children)}</div>;
};
const GenUIGrid = ({ props, children }: any) => {
    const columns = Number(props?.columns) > 0 ? Number(props.columns) : 1;
    const spacingMap: Record<string, string> = {
        none: '0',
        xs: '0.25rem',
        sm: '0.5rem',
        md: '0.75rem',
        lg: '1rem',
        xl: '1.5rem',
    };
    const gap = typeof props?.spacing === 'string'
        ? (spacingMap[props.spacing] ?? props.spacing)
        : undefined;
    const nextProps = {
        ...stripContentProp(props),
        className: cn('grid w-full', props?.className),
        style: {
            ...(props?.style && typeof props.style === 'object' ? props.style : {}),
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            ...(gap ? { gap } : {}),
        },
    };
    return <div {...nextProps}>{resolveSlot(props, children)}</div>;
};

// Map component types from JSON to our local Shadcn components
export const genUiComponents: any = {
    // Basic layout elements
    div: ({ props, children }: any) => <div {...props}>{children || props.children}</div>,
    Box: ({ props, children }: any) => <div {...props}>{children || props.children}</div>,
    span: GenUISpan,
    p: GenUIP,
    h1: GenUIH1,
    h2: GenUIH2,
    h3: GenUIH3,
    h4: GenUIH4,
    Stack: GenUIStack,
    stack: GenUIStack,
    VStack: GenUIStack,
    vstack: GenUIStack,
    HStack: ({ props, children }: any) => <GenUIStack props={{ ...props, direction: 'row' }} children={children} />,
    hstack: ({ props, children }: any) => <GenUIStack props={{ ...props, direction: 'row' }} children={children} />,
    Grid: GenUIGrid,
    grid: GenUIGrid,

    // Shadcn UI elements
    Card: GenUICard,
    CardHeader: GenUICardHeader,
    CardTitle: GenUICardTitle,
    CardDescription: GenUICardDescription,
    CardContent: GenUICardContent,
    CardFooter: GenUICardFooter,
    Button: GenUIButton,
    Badge: GenUIBadge,
    Input: GenUIInput,
    Label: GenUILabel,
    Separator: GenUISeparator,
    pre: GenUIPre,
    code: GenUICode,
    Text: GenUIText,
    ScrollArea: GenUIScrollArea,
    TabsList: GenUITabsList,
    TabsTrigger: GenUITabsTrigger,
    TabsContent: GenUITabsContent,
    ImageCover: GenUIImageCover,
    ImageAlbum: GenUIImageAlbum,
    ImageCarousel: GenUIImageCarousel,
    ComponentImageCard: GenUIComponentImageCard,
    ComfyUIImageCard: GenUIComponentImageCard,
    component_image_card: GenUIComponentImageCard,
    comfyui_image_card: GenUIComponentImageCard,
    image_cover: GenUIImageCover,
    image_album: GenUIImageAlbum,
    image_carousel: GenUIImageCarousel,
    'component.image': GenUIComponentImageCard,
    'comfyui.image': GenUIComponentImageCard,
    'image.cover': GenUIImageCover,
    'image.album': GenUIImageAlbum,
    'image.carousel': GenUIImageCarousel,
    VideoCover: GenUIVideoCover,
    VideoGallery: GenUIVideoGallery,
    VideoCarousel: GenUIVideoCarousel,
    ComponentVideoCard: GenUIComponentVideoCard,
    ComfyUIVideoCard: GenUIComponentVideoCard,
    component_video_card: GenUIComponentVideoCard,
    comfyui_video_card: GenUIComponentVideoCard,
    'component.video': GenUIComponentVideoCard,
    'comfyui.video': GenUIComponentVideoCard,
    video: GenUIVideoCover,
    videocover: GenUIVideoCover,
    videogallery: GenUIVideoGallery,
    videocarousel: GenUIVideoCarousel,
    video_cover: GenUIVideoCover,
    video_gallery: GenUIVideoGallery,
    video_carousel: GenUIVideoCarousel,
    'video.cover': GenUIVideoCover,
    'video.gallery': GenUIVideoGallery,
    'video.carousel': GenUIVideoCarousel,
    WebViewCard: GenUIWebViewCard,
    WebviewCard: GenUIWebViewCard,
    webview_card: GenUIWebViewCard,
    'webview.card': GenUIWebViewCard,
    WebView: GenUIWebViewCard,
    webview: GenUIWebViewCard,
    AudioPlayer: GenUIAudioPlayer,
    AudioPlaylist: GenUIAudioPlaylist,
    audio_player: GenUIAudioPlayer,
    audio_playlist: GenUIAudioPlaylist,
    'audio.player': GenUIAudioPlayer,
    'audio.playlist': GenUIAudioPlaylist,
    AudioCard: GenUIAudioPlayer,
    audio: GenUIAudioPlayer,
    MarkdownPreviewCard: GenUIMarkdownPreviewCard,
    markdown_preview: GenUIMarkdownPreviewCard,
    'markdown.preview': GenUIMarkdownPreviewCard,
    MarkdownPreview: GenUIMarkdownPreviewCard,
    OfficePreviewCard: GenUIOfficePreviewCard,
    OfficePreview: GenUIOfficePreviewCard,
    office_preview: GenUIOfficePreviewCard,
    'office.preview': GenUIOfficePreviewCard,
    office: GenUIOfficePreviewCard,
    OptionSelector: GenUIOptionSelector,
    optionselector: GenUIOptionSelector,
    option_selector: GenUIOptionSelector,
    'option.selector': GenUIOptionSelector,
    option: GenUIOptionSelector,
    AgentManagementConfirmCard: GenUIAgentManagementConfirmCard,
    agentmanagementconfirmcard: GenUIAgentManagementConfirmCard,
    agent_management_confirm_card: GenUIAgentManagementConfirmCard,
    'agent.management.confirm': GenUIAgentManagementConfirmCard,
    'agent-management-confirm': GenUIAgentManagementConfirmCard,
    GroupUpgradeCard: GenUIGroupUpgradeCard,
    groupupgradecard: GenUIGroupUpgradeCard,
    group_upgrade_card: GenUIGroupUpgradeCard,
    'group.upgrade': GenUIGroupUpgradeCard,
    'group-upgrade': GenUIGroupUpgradeCard,
    ChartCard: GenUIChartCard,
    PieChartCard: GenUIPieChartCard,
    BarChartCard: GenUIBarChartCard,
    LineChartCard: GenUILineChartCard,
    AreaChartCard: GenUIAreaChartCard,
    RadarChartCard: GenUIRadarChartCard,
    chart: GenUIChartCard,
    chart_card: GenUIChartCard,
    piechart: GenUIPieChartCard,
    pie_chart: GenUIPieChartCard,
    pie_chart_card: GenUIPieChartCard,
    barchart: GenUIBarChartCard,
    bar_chart: GenUIBarChartCard,
    bar_chart_card: GenUIBarChartCard,
    linechart: GenUILineChartCard,
    line_chart: GenUILineChartCard,
    line_chart_card: GenUILineChartCard,
    areachart: GenUIAreaChartCard,
    area_chart: GenUIAreaChartCard,
    area_chart_card: GenUIAreaChartCard,
    radarchart: GenUIRadarChartCard,
    radar_chart: GenUIRadarChartCard,
    radar_chart_card: GenUIRadarChartCard,
    'chart.pie': GenUIPieChartCard,
    'chart.bar': GenUIBarChartCard,
    'chart.line': GenUILineChartCard,
    'chart.area': GenUIAreaChartCard,
    'chart.radar': GenUIRadarChartCard,
};
