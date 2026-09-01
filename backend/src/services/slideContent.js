/*
 * Flatten Day Writer content-structure elements onto the slide fields the
 * layout library can draw, and pick a composition that matches the structure
 * instead of defaulting every slide to title + subtitle.
 */

const { boxOf, regionFromBox } = require('./subjectBox');

// On-photo Annotation is off: structure must not lock it, and photographs
// must not receive a callout overlay. Flip this to re-enable both paths.
const ANNOTATIONS_ENABLED = false;

function str(v) {
  return v == null ? '' : String(v).trim();
}

function stringList(value, limit = 8) {
  if (!Array.isArray(value)) return [];
  return value.map(str).filter(Boolean).slice(0, limit);
}

function mediaKeysOf(...values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const parts = Array.isArray(value) ? value : [value];
    for (const part of parts) {
      String(part || '').split(',').forEach((token) => {
        const key = str(token);
        if (!key || seen.has(key)) return;
        seen.add(key);
        out.push(key);
      });
    }
  }
  return out;
}

function asItems(value) {
  if (Array.isArray(value)) return stringList(value);
  const one = str(value);
  return one ? [one] : [];
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

const ANNOTATION_REGIONS = new Set([
  'top-left', 'top', 'top-right', 'left', 'center', 'right',
  'bottom-left', 'bottom', 'bottom-right',
]);

function annotationRegionOf(value) {
  const raw = str(value).toLowerCase().replace(/[_]+/g, '-').replace(/\s+/g, '-');
  if (ANNOTATION_REGIONS.has(raw)) return raw;
  const compact = raw.replace(/-/g, '');
  const aliases = {
    topleft: 'top-left', upperleft: 'top-left',
    topright: 'top-right', upperright: 'top-right',
    bottomleft: 'bottom-left', lowerleft: 'bottom-left',
    bottomright: 'bottom-right', lowerright: 'bottom-right',
    middle: 'center', mid: 'center',
  };
  return aliases[compact] || '';
}

function annotationOf(raw, elements) {
  if (!ANNOTATIONS_ENABLED) return null;
  const fromSlide = raw?.annotation && typeof raw.annotation === 'object' ? raw.annotation : null;
  const el = elementOf(elements, 'annotation');
  const text = str(
    fromSlide?.text
    || (typeof raw?.annotation === 'string' ? raw.annotation : '')
    || el?.text
    || el?.label,
  );
  if (!text) return null;
  const targetBox = boxOf(fromSlide?.targetBox || el?.targetBox || el?.box);
  const region = annotationRegionOf(fromSlide?.targetRegion || el?.targetRegion)
    || regionFromBox(targetBox)
    || 'center';
  return {
    text: text.slice(0, 48),
    targetSubject: str(fromSlide?.targetSubject || el?.targetSubject || el?.target).slice(0, 80),
    targetRegion: region,
    ...(targetBox ? { targetBox } : {}),
  };
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
    'image', 'multiple_images', 'detail_closeup', 'screenshot',
    'illustration', 'graphic_artwork', 'document_source', 'plan_drawing',
    'product_object', 'people_context', 'environment_space', 'video_motion',
    'screen_recording', 'animation', 'annotated_visual', 'multiple_visuals',
  );
  const annotation = annotationOf(s, elements);

  const items = asItems(s.items).length
    ? asItems(s.items)
    : asItems(listEl?.items).length
      ? asItems(listEl.items)
      : asItems(listEl?.text);
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
  const assetKeys = mediaKeysOf(visual.assetKeys, s.assetKeys, visual.assetKey, s.assetKey);
  const assetKey = assetKeys[0] || '';
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
    layoutHtml: str(s.layoutHtml),
    annotation,
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
  ANNOTATIONS_ENABLED,
  flattenSlide,
  layoutForStructure,
  visualNeedOf,
  annotationOf,
  stringList,
  mediaKeysOf,
  asStoredText,
  asStoredLines,
};
