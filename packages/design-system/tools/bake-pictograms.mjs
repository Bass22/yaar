// Bakes the hand-drawn tremble into the pictograms (backlog H.2, CLAUDE.md §4 rule 12): the
// mockup draws it at runtime with an SVG filter (feTurbulence + feDisplacementMap), which a
// low-end phone pays for on every frame. Here every shape is cut into close points, and each
// point is moved by a deterministic noise — same source, same drawing, every build.
//
//   node packages/design-system/tools/bake-pictograms.mjs           writes the generated files
//   node packages/design-system/tools/bake-pictograms.mjs --check   fails if they are out of date
//
// No dependency: the sources are our own small SVG files (packages/design-system/src/pictograms/source).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SOURCE_DIR = join(here, '../src/pictograms/source');
export const GENERATED_DIR = join(here, '../src/pictograms/generated');

// The tremble of the mockup's filter, in viewBox units of a 64-unit pictogram.
const AMPLITUDE = 1.1;
const FREQUENCY = 0.09;
// Longest straight piece before the tremble: shorter pieces, finer tremble.
const STEP = 1.6;

// ---------- a small XML reader, enough for our own sources ----------

/** Parses an SVG source into `{ name, attributes, children }` nodes; text is kept as `{ text }`. */
export function parseSvg(source) {
  const root = { name: '#root', attributes: [], children: [] };
  const stack = [root];
  const tokens = source.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g);
  for (const [, closing, opening, rawAttributes, selfClosing, text] of tokens) {
    const parent = stack[stack.length - 1];
    if (closing !== undefined) {
      stack.pop();
    } else if (opening !== undefined) {
      const attributes = [...rawAttributes.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]);
      const node = { name: opening, attributes, children: [] };
      parent.children.push(node);
      if (selfClosing !== '/') {
        stack.push(node);
      }
    } else if (text.trim() !== '') {
      parent.children.push({ text: text.trim() });
    }
  }
  return root.children.find((node) => node.name === 'svg');
}

// ---------- shapes as lists of points ----------

const number = (value) => Number.parseFloat(value ?? '0');

/** The subpaths of a path's `d`, as points, curves and arcs cut into short straight pieces. */
export function pathPoints(d) {
  const tokens = [...d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)/g)].map(([, command, value]) => command ?? Number(value));
  const subpaths = [];
  let points = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastControl = null;
  let command = null;
  let index = 0;
  const next = () => tokens[index++];
  const push = (px, py) => points.push([px, py]);
  const close = () => {
    if (points.length > 0) {
      subpaths.push({ points, closed: true });
    }
    points = [];
  };
  while (index < tokens.length) {
    if (typeof tokens[index] === 'string') {
      command = next();
    } else if (command === 'M') {
      command = 'L';
    } else if (command === 'm') {
      command = 'l';
    }
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case 'M':
        if (points.length > 1) {
          subpaths.push({ points, closed: false });
        }
        x = ox + next();
        y = oy + next();
        startX = x;
        startY = y;
        points = [[x, y]];
        lastControl = null;
        break;
      case 'L': {
        const tx = ox + next();
        const ty = oy + next();
        line(push, x, y, tx, ty);
        x = tx;
        y = ty;
        lastControl = null;
        break;
      }
      case 'H': {
        const tx = (relative ? x : 0) + next();
        line(push, x, y, tx, y);
        x = tx;
        lastControl = null;
        break;
      }
      case 'V': {
        const ty = (relative ? y : 0) + next();
        line(push, x, y, x, ty);
        y = ty;
        lastControl = null;
        break;
      }
      case 'C':
      case 'S': {
        const smooth = command.toUpperCase() === 'S';
        const [c1x, c1y] = smooth ? (lastControl?.cubic ? [2 * x - lastControl.x, 2 * y - lastControl.y] : [x, y]) : [ox + next(), oy + next()];
        const c2x = ox + next();
        const c2y = oy + next();
        const tx = ox + next();
        const ty = oy + next();
        curve(push, (t) => cubic(t, [x, y], [c1x, c1y], [c2x, c2y], [tx, ty]), length([x, y], [c1x, c1y], [c2x, c2y], [tx, ty]));
        lastControl = { x: c2x, y: c2y, cubic: true };
        x = tx;
        y = ty;
        break;
      }
      case 'Q':
      case 'T': {
        const smooth = command.toUpperCase() === 'T';
        const [cx, cy] = smooth ? (lastControl?.quadratic ? [2 * x - lastControl.x, 2 * y - lastControl.y] : [x, y]) : [ox + next(), oy + next()];
        const tx = ox + next();
        const ty = oy + next();
        curve(push, (t) => quadratic(t, [x, y], [cx, cy], [tx, ty]), length([x, y], [cx, cy], [tx, ty]));
        lastControl = { x: cx, y: cy, quadratic: true };
        x = tx;
        y = ty;
        break;
      }
      case 'A': {
        const rx = next();
        const ry = next();
        const rotation = next();
        const large = next();
        const sweep = next();
        const tx = ox + next();
        const ty = oy + next();
        arc(push, x, y, rx, ry, rotation, large, sweep, tx, ty);
        x = tx;
        y = ty;
        lastControl = null;
        break;
      }
      case 'Z':
        x = startX;
        y = startY;
        close();
        points = [];
        lastControl = null;
        if (typeof tokens[index] === 'number') {
          throw new Error(`Unexpected number after Z in "${d}"`);
        }
        break;
      default:
        throw new Error(`Unknown path command ${command} in "${d}"`);
    }
  }
  if (points.length > 1) {
    subpaths.push({ points, closed: false });
  }
  return subpaths;
}

function line(push, x0, y0, x1, y1) {
  const pieces = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / STEP));
  for (let i = 1; i <= pieces; i += 1) {
    push(x0 + ((x1 - x0) * i) / pieces, y0 + ((y1 - y0) * i) / pieces);
  }
}

function curve(push, at, approximateLength) {
  const pieces = Math.max(2, Math.ceil(approximateLength / STEP));
  for (let i = 1; i <= pieces; i += 1) {
    push(...at(i / pieces));
  }
}

const length = (...points) => points.slice(1).reduce((sum, [px, py], i) => sum + Math.hypot(px - points[i][0], py - points[i][1]), 0);
const cubic = (t, p0, p1, p2, p3) => [0, 1].map((k) => (1 - t) ** 3 * p0[k] + 3 * (1 - t) ** 2 * t * p1[k] + 3 * (1 - t) * t ** 2 * p2[k] + t ** 3 * p3[k]);
const quadratic = (t, p0, p1, p2) => [0, 1].map((k) => (1 - t) ** 2 * p0[k] + 2 * (1 - t) * t * p1[k] + t ** 2 * p2[k]);

// SVG arc from the end-point to the centre form (SVG 1.1, appendix F.6.5).
function arc(push, x1, y1, rx, ry, rotationDeg, largeArc, sweep, x2, y2) {
  if (rx === 0 || ry === 0) {
    line(push, x1, y1, x2, y2);
    return;
  }
  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  let rxa = Math.abs(rx);
  let rya = Math.abs(ry);
  const lambda = (x1p * x1p) / (rxa * rxa) + (y1p * y1p) / (rya * rya);
  if (lambda > 1) {
    rxa *= Math.sqrt(lambda);
    rya *= Math.sqrt(lambda);
  }
  const numerator = rxa * rxa * rya * rya - rxa * rxa * y1p * y1p - rya * rya * x1p * x1p;
  const denominator = rxa * rxa * y1p * y1p + rya * rya * x1p * x1p;
  const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (factor * rxa * y1p) / rya;
  const cyp = (-factor * rya * x1p) / rxa;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta = angle(1, 0, (x1p - cxp) / rxa, (y1p - cyp) / rya);
  let delta = angle((x1p - cxp) / rxa, (y1p - cyp) / rya, (-x1p - cxp) / rxa, (-y1p - cyp) / rya);
  if (!sweep && delta > 0) {
    delta -= 2 * Math.PI;
  } else if (sweep && delta < 0) {
    delta += 2 * Math.PI;
  }
  const pieces = Math.max(4, Math.ceil((Math.abs(delta) * Math.max(rxa, rya)) / STEP));
  for (let i = 1; i <= pieces; i += 1) {
    const t = theta + (delta * i) / pieces;
    push(cx + rxa * Math.cos(t) * cos - rya * Math.sin(t) * sin, cy + rxa * Math.cos(t) * sin + rya * Math.sin(t) * cos);
  }
}

function ellipsePoints(cx, cy, rx, ry) {
  const pieces = Math.max(16, Math.ceil((2 * Math.PI * Math.max(rx, ry)) / STEP));
  return Array.from({ length: pieces }, (_, i) => [cx + rx * Math.cos((2 * Math.PI * i) / pieces), cy + ry * Math.sin((2 * Math.PI * i) / pieces)]);
}

/** The geometry of a shape element as subpaths of points; `null` for what is not a shape. */
export function shapeSubpaths(node) {
  const a = Object.fromEntries(node.attributes);
  switch (node.name) {
    case 'path':
      return pathPoints(a.d);
    case 'circle':
      return [{ points: ellipsePoints(number(a.cx), number(a.cy), number(a.r), number(a.r)), closed: true }];
    case 'ellipse':
      return [{ points: ellipsePoints(number(a.cx), number(a.cy), number(a.rx), number(a.ry)), closed: true }];
    case 'line':
      return pathPoints(`M${a.x1 ?? 0} ${a.y1 ?? 0} L${a.x2 ?? 0} ${a.y2 ?? 0}`);
    case 'polygon':
    case 'polyline': {
      const values = a.points.trim().split(/[\s,]+/).map(Number);
      const pairs = [];
      for (let i = 0; i + 1 < values.length; i += 2) {
        pairs.push(`${values[i]} ${values[i + 1]}`);
      }
      return pathPoints(`M${pairs.join(' L')}${node.name === 'polygon' ? ' Z' : ''}`);
    }
    case 'rect': {
      const x = number(a.x);
      const y = number(a.y);
      const w = number(a.width);
      const h = number(a.height);
      const r = Math.min(number(a.rx ?? a.ry), w / 2, h / 2);
      return pathPoints(
        r > 0
          ? `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`
          : `M${x} ${y} H${x + w} V${y + h} H${x} Z`,
      );
    }
    default:
      return null;
  }
}

const GEOMETRY = { path: ['d'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'], line: ['x1', 'y1', 'x2', 'y2'], polygon: ['points'], polyline: ['points'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry'] };

// ---------- the tremble: a deterministic noise ----------

/** A whole-number seed from a name: the same pictogram trembles the same way, build after build. */
export function seedOf(name) {
  let hash = 2166136261;
  for (const char of name) {
    hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0;
  }
  return hash;
}

function lattice(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = lattice(ix, iy, seed) + sx * (lattice(ix + 1, iy, seed) - lattice(ix, iy, seed));
  const bottom = lattice(ix, iy + 1, seed) + sx * (lattice(ix + 1, iy + 1, seed) - lattice(ix, iy + 1, seed));
  return top + sy * (bottom - top);
}

/** Two octaves, centred on zero, between -1 and 1 — as the mockup's `numOctaves="2"`. */
function noise(x, y, seed) {
  return (valueNoise(x, y, seed) * 2 + valueNoise(x * 2, y * 2, seed + 1)) / 3 * 2 - 1;
}

export function tremble([x, y], seed, scale) {
  const f = FREQUENCY / scale;
  return [x + AMPLITUDE * scale * noise(x * f, y * f, seed), y + AMPLITUDE * scale * noise(x * f + 31.7, y * f + 17.3, seed + 7)];
}

const format = (value) => Number(value.toFixed(2)).toString();

function pathData(subpaths, seed, scale) {
  return subpaths
    .map(({ points, closed }) => {
      const moved = points.map((point) => tremble(point, seed, scale).map(format).join(' '));
      return `M${moved[0]}${moved.length > 1 ? `L${moved.slice(1).join(' ')}` : ''}${closed ? 'Z' : ''}`;
    })
    .join('');
}

// ---------- baking ----------

const escapeAttribute = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const escapeText = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function bakeNode(node, seed, scale, indent) {
  if (node.text !== undefined) {
    return `${indent}${escapeText(node.text)}`;
  }
  const subpaths = shapeSubpaths(node);
  const kept = node.attributes.filter(([key]) => subpaths === null || !GEOMETRY[node.name].includes(key));
  if (subpaths !== null) {
    const attributes = [['d', pathData(subpaths, seed, scale)], ...kept].map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join('');
    return `${indent}<path${attributes}/>`;
  }
  const attributes = kept.map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join('');
  if (node.children.length === 0) {
    return `${indent}<${node.name}${attributes}/>`;
  }
  if (node.children.every((child) => child.text !== undefined)) {
    return `${indent}<${node.name}${attributes}>${node.children.map((child) => escapeText(child.text)).join(' ')}</${node.name}>`;
  }
  return `${indent}<${node.name}${attributes}>\n${node.children.map((child) => bakeNode(child, seed, scale, `${indent}  `)).join('\n')}\n${indent}</${node.name}>`;
}

/** One baked `<symbol>` from a source file's text. */
export function bakeSymbol(name, source) {
  const svg = parseSvg(source);
  if (svg === undefined) {
    throw new Error(`${name}: no <svg> root`);
  }
  const viewBox = Object.fromEntries(svg.attributes).viewBox;
  const width = Number(viewBox.split(/\s+/)[2]);
  const seed = seedOf(name);
  const body = svg.children.map((child) => bakeNode(child, seed, width / 64, '    ')).join('\n');
  return `  <symbol id="${name}" viewBox="${viewBox}">\n${body}\n  </symbol>`;
}

/** Every pictogram of the source folder, baked: the sprite and the TypeScript list of names. */
export function bakeAll(sourceDir = SOURCE_DIR) {
  const files = readdirSync(sourceDir).filter((file) => file.endsWith('.svg')).sort();
  const names = files.map((file) => basename(file, '.svg'));
  const symbols = files.map((file, i) => bakeSymbol(names[i], readFileSync(join(sourceDir, file), 'utf8')));
  const sprite = `<!-- Generated by packages/design-system/tools/bake-pictograms.mjs from src/pictograms/source: do not edit. -->\n<svg xmlns="http://www.w3.org/2000/svg">\n${symbols.join('\n')}\n</svg>\n`;
  const typescript = `// Generated by packages/design-system/tools/bake-pictograms.mjs from src/pictograms/source: do not edit.\nexport const PICTOGRAM_NAMES = [\n${names.map((name) => `  '${name}',`).join('\n')}\n] as const;\n\nexport type PictogramName = (typeof PICTOGRAM_NAMES)[number];\n`;
  return { sprite, typescript, names };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { sprite, typescript } = bakeAll();
  const outputs = [
    [join(GENERATED_DIR, 'pictograms.svg'), sprite],
    [join(GENERATED_DIR, 'pictogram-names.ts'), typescript],
  ];
  if (process.argv.includes('--check')) {
    const stale = outputs.filter(([path, text]) => {
      try {
        return readFileSync(path, 'utf8') !== text;
      } catch {
        return true;
      }
    });
    if (stale.length > 0) {
      console.error(`Pictograms out of date: run node packages/design-system/tools/bake-pictograms.mjs (${stale.map(([path]) => basename(path)).join(', ')})`);
      process.exit(1);
    }
  } else {
    for (const [path, text] of outputs) {
      writeFileSync(path, text);
    }
  }
}
