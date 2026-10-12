// HTML/JSX tag intelligence: tag and attribute lists, open-tag stack, and caret context detection.
// Pure functions (no DOM) so they can be unit tested under Node.

// Ordered by how often they're used so the popup leads with the likely candidates.
export const HTML_TAGS = `div span a p img ul li ol button input form label h1 h2 h3 h4 h5 h6 section article header footer nav main aside table thead tbody tfoot tr td th select option textarea
pre code strong em b i u small br hr video audio source canvas svg path circle rect g iframe link script style meta title head body html details summary dialog figure figcaption picture template slot
blockquote cite abbr time mark sub sup kbd samp var dl dt dd fieldset legend optgroup datalist output progress meter address area base col colgroup map noscript object param track wbr del ins bdi bdo data menu`.split(/\s+/).filter(Boolean);

export const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));

const GLOBAL_ATTRS = 'class id style title lang dir hidden tabindex role data- aria-label aria-hidden contenteditable draggable onclick onchange oninput onsubmit'.split(' ');
const TAG_ATTRS = {
  a: 'href target rel download',
  img: 'src alt width height loading srcset sizes',
  input: 'type name value placeholder required disabled checked readonly min max step pattern autocomplete autofocus',
  button: 'type disabled name value',
  form: 'action method enctype novalidate',
  label: 'for',
  link: 'rel href type media as crossorigin',
  script: 'src type async defer crossorigin module',
  meta: 'name content charset property http-equiv',
  select: 'name multiple required disabled',
  option: 'value selected disabled',
  textarea: 'name rows cols placeholder required disabled maxlength',
  video: 'src controls autoplay loop muted poster preload playsinline',
  audio: 'src controls autoplay loop muted preload',
  source: 'src srcset type media',
  iframe: 'src title allow sandbox loading',
  td: 'colspan rowspan', th: 'colspan rowspan scope',
  svg: 'viewBox width height fill xmlns', path: 'd fill stroke stroke-width', circle: 'cx cy r fill', rect: 'x y width height rx fill',
};
export const BOOLEAN_ATTRS = new Set('hidden required disabled checked readonly multiple selected autofocus async defer controls autoplay loop muted playsinline novalidate download module draggable contenteditable'.split(' '));

export function attrsFor(tag) {
  const own = (TAG_ATTRS[tag.toLowerCase()] || '').split(' ').filter(Boolean);
  return [...new Set([...own, ...GLOBAL_ATTRS])];
}

const IDENT = '[A-Za-z][\\w:.-]*';
const OPEN_TAG_RE = new RegExp(`<!--[\\s\\S]*?-->|<(\\/?)(${IDENT})((?:"[^"]*"|'[^']*'|[^<>"'])*?)(\\/?)>`, 'g');

// Names of tags that are still open at the end of `text` (innermost last).
export function openTagStack(text) {
  const stack = [];
  OPEN_TAG_RE.lastIndex = 0;
  let m;
  while ((m = OPEN_TAG_RE.exec(text))) {
    const name = m[2];
    if (!name) continue; // comment
    if (m[1]) {
      const i = stack.lastIndexOf(name);
      if (i >= 0) stack.length = i;
    } else if (!m[4] && !VOID.has(name.toLowerCase())) stack.push(name);
  }
  return stack;
}

// A '<' counts as a tag start when it isn't glued to an identifier (so `Array<string>` and `a<b` are ignored).
// In plain HTML any '<' starts a tag; in JSX the strict rule applies.
const ltRule = (strict) => (strict ? '(^|[^\\w$.)\\]])' : '()');
const glued = (strict, ch) => strict && /[\w$.)\]]/.test(ch || '');

// What is the caret doing, given the text before it on the line?
//   { type: 'close', prefix }          after "</"
//   { type: 'open', prefix }           after "<" (tag name being typed)
//   { type: 'attr', prefix, tag }      inside an opening tag, typing an attribute name
//   null                               anywhere else
export function contextAt(before, strict = false) {
  const LT = ltRule(strict);
  let m = new RegExp(`${LT}<\\/([\\w:.-]*)$`).exec(before);
  if (m) return { type: 'close', prefix: m[2] };
  m = new RegExp(`${LT}<(${IDENT})?$`).exec(before);
  if (m) return { type: 'open', prefix: m[2] || '' };
  const lt = before.lastIndexOf('<');
  if (lt >= 0 && before.lastIndexOf('>') < lt && (lt === 0 || !glued(strict, before[lt - 1]))) {
    const seg = before.slice(lt);
    const tag = new RegExp(`^<(${IDENT})\\s`).exec(seg);
    if (tag) {
      const quotesOpen = (seg.match(/"/g) || []).length % 2 || (seg.match(/'/g) || []).length % 2;
      if (!quotesOpen && !/=\s*$/.test(seg) && !/=[^\s"'>]*$/.test(seg)) {
        return { type: 'attr', prefix: /([\w:@.-]*)$/.exec(seg)[1], tag: tag[1], seg };
      }
    }
  }
  return null;
}

// If typing ">" right after `before` completes an opening tag that needs a closing tag, return its name.
export function tagToClose(before, strict = false) {
  const lt = before.lastIndexOf('<');
  if (lt < 0 || (lt > 0 && glued(strict, before[lt - 1]))) return null;
  const seg = before.slice(lt);
  const m = new RegExp(`^<(${IDENT})((?:\\s(?:"[^"]*"|'[^']*'|[^<>"'])*)?)$`).exec(seg);
  if (!m || seg.endsWith('/')) return null;
  if (VOID.has(m[1].toLowerCase())) return null;
  return m[1];
}
