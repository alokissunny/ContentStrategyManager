/*
 * Flatten Day Writer content-structure elements onto the slide fields the
 * layout library can draw, and pick a composition that matches the structure
 * instead of defaulting every slide to title + subtitle.
 */

function str(v) {
  return v == null ? '' : String(v).trim();
}

function stringList(value, limit = 8) {
  if (!Array.isArray(value)) return [];
  return value.map(str).filter(Boolean).slice(0, limit);
}

function normType(type) {
  return str(type).toLowerCase().replace(/[\s/-]+/g, '_');
}

function elementOf(elements, ...types) {
  const want = new Set(types.map(normType));
  return (elements || []).find((e) => want.has(normType(e?.type))) || null;
}

function asStoredText(value) {
  if (value == null || value === '') return '';
  if (Array.isArray(value)) {
    return value.map((x) => asStoredText(x)).filter(Boolean).join('\n');
  }
  if (typeof value === 'object') {
    return String(value.text || value.note || value.need || '').trim();
  }
  return String(value).trim();
}

function asStoredLines(value, limit = 16) {
  if (!Array.isArray(value)) {
    const one = asStoredText(value);
    return one ? [one] : [];
  }
  return value.map((x) => asStoredText(x)).filter(Boolean).slice(0, limit);
}

function visualNeedOf(s) {
  const visual = (s?.visualNeed && typeof s.visualNeed === 'object')
    ? s.visualNeed
    : (s?.visual && typeof s.visual === 'object' ? s.visual : {});
  const priority = str(visual.priority).toLowerCase();
  const type = str(visual.type);
  const execution = str(visual.execution).toLowerCase();
  const source = str(visual.source).toLowerCase();
  const wants = (priority && priority !== 'none')
    || (source && source !== 'none')
    || (type && type.toLowerCase() !== 'none')
    || /supplied|generated|graphic|unresolved/.test(execution)
    || str(s?.image).toLowerCase() === 'placeholder';
  if (!wants) return null;
  return {
    priority: priority && priority !== 'none' ? priority : 'recommended',
    type: type && type.toLowerCase() !== 'none' ? type : '',
    role: str(visual.role),
    communicationFunction: str(visual.communicationFunction),
    truthBoundary: str(visual.truthBoundary),
    execution,
    productionInstruction: str(visual.productionInstruction),
  };
}

function flattenSlide(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const visual = s.visual && typeof s.visual === 'object' ? s.visual : {};
  const elements = Array.isArray(s.elements) ? s.elements : [];
  const titleEl = elementOf(elements, 'title', 'short_statement', 'question');
  const subEl = elementOf(elements, 'subtitle', 'supporting_text', 'caption_label', 'label');
  const bodyEl = elementOf(elements, 'body', 'reason', 'rational', 'reason_rationale', 'example');
  const listEl = elementOf(
    elements,
    'list', 'numbered_items', 'steps', 'options', 'sequence', 'checklist',
    'ranking', 'timeline', 'process_flow', 'framework', 'categories_groups', 'progression',
    'hierarchy', 'diagram',
  );
  const quoteEl = elementOf(elements, 'quote', 'testimonial');
  const statEl = elementOf(elements, 'number_stat', 'number', 'stat', 'data_chart');
  const actionEl = elementOf(elements, 'action');
  const cmpEl = elementOf(
    elements,
    'comparison', 'pros_cons', 'do_dont', 'problem_solution', 'cause_effect',
  );
  const baEl = elementOf(elements, 'before_after');
  const imageEl = elementOf(
    elements,
    'image', 'multiple_images', 'annotation', 'detail_closeup', 'screenshot',
    'illustration', 'graphic_artwork', 'document_source', 'plan_drawing',
    'product_object', 'people_context', 'environment_space', 'video_motion',
    'screen_recording', 'animation', 'annotated_visual', 'multiple_visuals',
  );

  const items = stringList(s.items).length
    ? stringList(s.items)
    : stringList(listEl?.items || listEl?.text);
  const itemsA = stringList(s.itemsA || cmpEl?.itemsA || cmpEl?.leftItems);
  const itemsB = stringList(s.itemsB || cmpEl?.itemsB || cmpEl?.rightItems);
  const comparisonA = str(
    s.comparisonA || s.comparison?.a || cmpEl?.comparisonA || cmpEl?.a || cmpEl?.left || baEl?.before || baEl?.a,
  );
  const comparisonB = str(
    s.comparisonB || s.comparison?.b || cmpEl?.comparisonB || cmpEl?.b || cmpEl?.right || baEl?.after || baEl?.b,
  );
  const labels = stringList(s.labels || baEl?.labels || cmpEl?.labels || subEl?.label);
  const quote = str(s.quote || quoteEl?.text || quoteEl?.quote);
  const stat = str(s.stat || statEl?.stat || statEl?.value || statEl?.text || statEl?.number);
  const action = str(s.action || actionEl?.text || actionEl?.action);
  const body = str(s.body || bodyEl?.text || bodyEl?.body);
  const title = str(s.title || titleEl?.text || quote || action || comparisonA);
  const subtitle = str(s.subtitle || subEl?.text || statEl?.label || subEl?.label);
  const primary = str(
    s.structure
    || titleEl?.type
    || subEl?.type
    || (comparisonA && comparisonB && (baEl ? 'Before_After' : 'Comparison'))
    || (items.length >= 2 && listEl?.type)
    || (stat && 'Number_Stat')
    || (quote && 'Quote')
    || (action && 'Action')
    || (body && 'Body')
    || 'Title',
  );
  const priority = str(visual.priority).toLowerCase();
  const source = str(visual.source).toLowerCase();
  const assetKeys = stringList(visual.assetKeys || s.assetKeys);
  const assetKey = str(s.assetKey || visual.assetKey || assetKeys[0]);
  const wantsImage = Boolean(imageEl)
    || /image|illustration|screenshot|document|drawing|artwork|product|people|environment|video|animation|annotated|multiple/i.test(primary)
    || str(s.image).toLowerCase() === 'placeholder'
    || (priority && priority !== 'none')
    || (source && source !== 'none')
    || /supplied|generated/.test(str(visual.execution).toLowerCase());

  return {
    role: str(s.role),
    structure: primary,
    title,
    subtitle,
    body,
    items,
    itemsA,
    itemsB,
    stat,
    quote,
    action,
    comparisonA,
    comparisonB,
    labels: labels.length
      ? labels
      : (/before/i.test(primary) ? ['Before', 'After'] : []),
    image: wantsImage ? 'placeholder' : str(s.image),
    imagePrompt: str(s.imagePrompt || visual.imagePrompt),
    assetKey,
    assetKeys: assetKeys.length ? assetKeys : (assetKey ? [assetKey] : []),
    layout: str(s.layout),
    visual,
    visualNeed: visualNeedOf({ ...s, visual, image: wantsImage ? 'placeholder' : str(s.image) }),
    textLayout: s.textLayout && typeof s.textLayout === 'object' ? s.textLayout : null,
  };
}

function layoutForStructure(slide) {
  const s = `${slide.structure || ''}`.toLowerCase();
  const named = (re) => re.test(s);
  const listIntent = named(/list|step|number|option|timeline|sequence|checklist|ranking|process|framework|categor|progress|hierarch|diagram/)
    || (!s && slide.items.length >= 2);
  if (listIntent && slide.items.length >= 2) {
    if (/step|timeline|sequence|process|progress/.test(s)) return 'n-story-timeline';
    return 'e-edu-framework';
  }
  if (slide.comparisonA && slide.comparisonB && (named(/compar|before|after|pros|dont|problem|cause/) || !s || (!slide.title && !slide.body))) {
    if (/before/.test(s)) return 'e-cmp-duo';
    if (slide.itemsA.length || slide.itemsB.length) return 'n-cmp-columns';
    return 'e-cmp-two';
  }
  if (slide.stat && (named(/stat|number/) || !slide.title)) {
    return (slide.body || slide.subtitle) ? 'n-res-statcopy' : 'b-res-metric';
  }
  if (slide.quote && named(/quote|testimonial/)) return 'n-res-quotenote';
  if (slide.action && named(/action/)) return 'n-cta-centered';
  if (named(/short_statement|question/) && !slide.body && !slide.subtitle) return 'e-hook-statement';
  if (named(/image|caption|multiple/)) return 'n-hook-band';
  if (named(/body/) && (slide.body || '').length > 90) return 'n-story-magazine';
  if (slide.body || slide.subtitle) return '';
  return '';
}

module.exports = {
  flattenSlide,
  layoutForStructure,
  visualNeedOf,
  stringList,
  asStoredText,
  asStoredLines,
};
