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

function flattenSlide(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const elements = Array.isArray(s.elements) ? s.elements : [];
  const titleEl = elementOf(elements, 'title', 'short_statement', 'question');
  const subEl = elementOf(elements, 'subtitle', 'supporting_text', 'caption_label');
  const bodyEl = elementOf(elements, 'body', 'reason', 'rational');
  const listEl = elementOf(elements, 'list', 'numbered_items', 'steps', 'options');
  const quoteEl = elementOf(elements, 'quote');
  const statEl = elementOf(elements, 'number_stat', 'number', 'stat');
  const actionEl = elementOf(elements, 'action');
  const cmpEl = elementOf(elements, 'comparison');
  const baEl = elementOf(elements, 'before_after');
  const imageEl = elementOf(elements, 'image', 'multiple_images');

  const items = stringList(s.items).length
    ? stringList(s.items)
    : stringList(listEl?.items || listEl?.text);
  const itemsA = stringList(s.itemsA || cmpEl?.itemsA || cmpEl?.leftItems);
  const itemsB = stringList(s.itemsB || cmpEl?.itemsB || cmpEl?.rightItems);
  const comparisonA = str(s.comparisonA || s.comparison?.a || cmpEl?.a || cmpEl?.left || baEl?.before || baEl?.a);
  const comparisonB = str(s.comparisonB || s.comparison?.b || cmpEl?.b || cmpEl?.right || baEl?.after || baEl?.b);
  const labels = stringList(s.labels || baEl?.labels || cmpEl?.labels);
  const quote = str(s.quote || quoteEl?.text);
  const stat = str(s.stat || statEl?.value || statEl?.text || statEl?.number);
  const action = str(s.action || actionEl?.text);
  const body = str(s.body || bodyEl?.text);
  const title = str(s.title || titleEl?.text || quote || action || comparisonA);
  const subtitle = str(s.subtitle || subEl?.text || statEl?.label);
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
  const wantsImage = Boolean(imageEl)
    || /^(image|caption_label|multiple_images)$/i.test(primary)
    || str(s.image).toLowerCase() === 'placeholder';

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
    imagePrompt: '',
    assetKey: str(s.assetKey),
    layout: str(s.layout),
  };
}

function layoutForStructure(slide) {
  const s = `${slide.structure || ''}`.toLowerCase();
  const named = (re) => re.test(s);
  const listIntent = named(/list|step|number|option|timeline/)
    || (!s && slide.items.length >= 2);
  if (listIntent && slide.items.length >= 2) {
    if (/step|timeline/.test(s)) return 'n-story-timeline';
    return 'e-edu-framework';
  }
  if (slide.comparisonA && slide.comparisonB && (named(/compar|before|after/) || !s || (!slide.title && !slide.body))) {
    if (/before/.test(s)) return 'e-cmp-duo';
    if (slide.itemsA.length || slide.itemsB.length) return 'n-cmp-columns';
    return 'e-cmp-two';
  }
  if (slide.stat && (named(/stat|number/) || !slide.title)) {
    return (slide.body || slide.subtitle) ? 'n-res-statcopy' : 'b-res-metric';
  }
  if (slide.quote && named(/quote/)) return 'n-res-quotenote';
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
  stringList,
};
