type Primitive = string | number | boolean | null | undefined;

type SectionItem = {
  label?: Primitive;
  value?: Primitive;
};

type Section = {
  title?: Primitive;
  items?: SectionItem[];
};

type ProfileIntroCardProps = {
  name?: Primitive;
  title?: Primitive;
  subtitle?: Primitive;
  summary?: Primitive;
  avatar?: Primitive;
  coverImage?: Primitive;
  tags?: Primitive[];
  sections?: Section[];
};

function asText(value: Primitive): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asText(item as Primitive))
    .filter(Boolean);
}

function pickProps(element: any): ProfileIntroCardProps {
  const raw = element?.props && typeof element.props === 'object' ? element.props : {};
  return {
    name: raw.name,
    title: raw.title,
    subtitle: raw.subtitle ?? raw.desc ?? raw.description,
    summary: raw.summary ?? raw.content,
    avatar: raw.avatar ?? raw.emoji,
    coverImage: raw.coverImage ?? raw.cover ?? raw.image,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    sections: Array.isArray(raw.sections) ? raw.sections : [],
  };
}

function createElement(type: string, props: Record<string, unknown> = {}, children?: string[]) {
  const node: Record<string, unknown> = { type, props };
  if (children && children.length > 0) {
    node.children = children;
  }
  return node;
}

export default function ProfileIntroCard({ element }: any) {
  const props = pickProps(element);

  const name = asText(props.name) || '未命名人物';
  const title = asText(props.title);
  const subtitle = asText(props.subtitle);
  const summary = asText(props.summary);
  const avatar = asText(props.avatar) || '👤';
  const coverImage = asText(props.coverImage);
  const tags = asTextArray(props.tags).slice(0, 12);
  const sections = Array.isArray(props.sections) ? props.sections : [];

  const elements: Record<string, unknown> = {
    root: createElement('Card', { className: 'w-full overflow-hidden border-border/60 bg-card/95 shadow-sm' }, [
      'hero',
      'content',
    ]),
    hero: createElement('div', {
      className: coverImage
        ? 'relative border-b border-border/50 bg-cover bg-center p-5 text-white'
        : 'border-b border-border/50 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-5 text-white',
      style: coverImage ? { backgroundImage: `linear-gradient(rgba(15,23,42,0.72), rgba(15,23,42,0.82)), url(${coverImage})` } : undefined,
    }, ['hero-row']),
    'hero-row': createElement('div', { className: 'flex items-start gap-4' }, ['avatar', 'hero-meta']),
    avatar: createElement('div', {
      className: 'flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-3xl backdrop-blur-sm',
      children: avatar,
    }),
    'hero-meta': createElement('div', { className: 'min-w-0 flex-1 space-y-2' }, [
      'name',
      ...(title ? ['title'] : []),
      ...(subtitle ? ['subtitle'] : []),
      ...(tags.length > 0 ? ['tag-list'] : []),
    ]),
    name: createElement('h2', { className: 'text-2xl font-semibold tracking-tight', children: name }),
    title: createElement('p', { className: 'text-sm font-medium text-white/90', children: title }),
    subtitle: createElement('p', { className: 'text-sm leading-6 text-white/75', children: subtitle }),
    'tag-list': createElement('div', { className: 'flex flex-wrap gap-2 pt-1' }, []),
    content: createElement('CardContent', { className: 'space-y-5 p-5' }, [
      ...(summary ? ['summary-box'] : []),
      ...sections.map((_, index) => `section-${index}`),
    ]),
    'summary-box': createElement('div', { className: 'rounded-xl border border-border/60 bg-muted/30 p-4 text-sm leading-7 text-foreground/90 whitespace-pre-wrap' }, ['summary-text']),
    'summary-text': createElement('p', { className: 'text-sm leading-7', children: summary }),
  };

  tags.forEach((tag, index) => {
    elements[`tag-${index}`] = createElement('Badge', {
      variant: 'secondary',
      className: 'rounded-full border-0 bg-white/12 text-white hover:bg-white/12',
      children: tag,
    });
  });
  (elements['tag-list'] as Record<string, unknown>).children = tags.map((_, index) => `tag-${index}`);

  sections.forEach((section, sectionIndex) => {
    const sectionTitle = asText(section?.title) || `信息分组 ${sectionIndex + 1}`;
    const items = Array.isArray(section?.items) ? section.items : [];
    const rowIds: string[] = [];

    elements[`section-${sectionIndex}`] = createElement('div', {
      className: 'space-y-3 rounded-xl border border-border/60 bg-background/70 p-4',
    }, [`section-${sectionIndex}-title`, ...rowIds]);

    elements[`section-${sectionIndex}-title`] = createElement('div', { className: 'flex items-center gap-3' }, [
      `section-${sectionIndex}-heading`,
      `section-${sectionIndex}-separator`,
    ]);
    elements[`section-${sectionIndex}-heading`] = createElement('h3', {
      className: 'shrink-0 text-sm font-semibold tracking-wide text-foreground/95',
      children: sectionTitle,
    });
    elements[`section-${sectionIndex}-separator`] = createElement('Separator', { className: 'flex-1' });

    items.forEach((item, itemIndex) => {
      const label = asText(item?.label) || `字段 ${itemIndex + 1}`;
      const value = asText(item?.value) || '-';
      const rowId = `section-${sectionIndex}-row-${itemIndex}`;
      rowIds.push(rowId);
      elements[rowId] = createElement('div', {
        className: 'grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3 rounded-lg px-3 py-2 even:bg-muted/25',
      }, [`${rowId}-label`, `${rowId}-value`]);
      elements[`${rowId}-label`] = createElement('span', {
        className: 'text-xs font-medium uppercase tracking-wide text-muted-foreground',
        children: label,
      });
      elements[`${rowId}-value`] = createElement('p', {
        className: 'min-w-0 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90',
        children: value,
      });
    });

    if (items.length === 0) {
      const emptyId = `section-${sectionIndex}-empty`;
      rowIds.push(emptyId);
      elements[emptyId] = createElement('p', {
        className: 'text-sm text-muted-foreground',
        children: '暂无信息',
      });
    }

    (elements[`section-${sectionIndex}`] as Record<string, unknown>).children = [
      `section-${sectionIndex}-title`,
      ...rowIds,
    ];
  });

  return {
    root: 'root',
    elements,
  };
}
