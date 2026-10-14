import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { classicApp } from './classic-module-loader.js';
const require = createRequire(classicApp + '/package.json');
const postcss = require('postcss');
const selectors = require('postcss-selector-parser');

// Structural selector checks on React SSR output, NOT a browser layout engine.
// Only the selector/media syntax used by the scoped inherited stylesheet is
// accepted; unsupported syntax throws instead of silently reporting success.
export function parseMarkup(html) {
  const root = { tag: '#document', attrs: {}, children: [], parent: null };
  const stack = [root];
  for (const token of html.matchAll(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g)) {
    const value = token[0];
    if (value.startsWith('<!--')) continue;
    const tag = /^<\/?([^\s/>]+)/.exec(value)[1].toLowerCase();
    if (value.startsWith('</')) {
      assert.equal(stack.at(-1).tag, tag, 'balanced React SSR markup');
      stack.pop(); continue;
    }
    const attrs = {};
    const tail = value.slice(value.indexOf(tag) + tag.length);
    for (const match of tail.matchAll(/([^\s=/>]+)(?:="([^"]*)")?/g)) attrs[match[1].toLowerCase()] = match[2] ?? '';
    const node = { tag, attrs, children: [], parent: stack.at(-1) };
    node.parent.children.push(node);
    if (!['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'].includes(tag) && !value.endsWith('/>')) stack.push(node);
  }
  assert.equal(stack.length, 1); return root;
}
export const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
const classHas = (node, name) => (node.attrs.class ?? '').split(/\s+/).includes(name);
function simple(node, token) {
  switch (token.type) {
    case 'tag': return node.tag === token.value;
    case 'class': return classHas(node, token.value);
    case 'id': return node.attrs.id === token.value;
    case 'universal': return true;
    case 'attribute':
      assert.ok(!token.operator || token.operator === '=');
      return Object.hasOwn(node.attrs, token.attribute) && (!token.operator || node.attrs[token.attribute] === token.value);
    case 'pseudo':
      if (token.value === ':is') return token.nodes.some(selector => matches(node, selector));
      if (token.value === ':has') return descendants(node).some(child => token.nodes.some(selector => matches(child, selector)));
      throw Error('Unsupported pseudo ' + token.value);
    default: throw Error('Unsupported selector node ' + token.type);
  }
}
function matches(node, selector) {
  const parts = [[]], combinators = [];
  for (const token of selector.nodes) {
    if (token.type === 'combinator') { combinators.push(token.value.trim() || ' '); parts.push([]); }
    else parts.at(-1).push(token);
  }
  function at(candidate, index) {
    if (!candidate || !parts[index].every(token => simple(candidate, token))) return false;
    if (!index) return true;
    if (combinators[index - 1] === '>') return at(candidate.parent, index - 1);
    assert.equal(combinators[index - 1], ' ');
    for (let parent = candidate.parent; parent; parent = parent.parent) if (at(parent, index - 1)) return true;
    return false;
  }
  return at(node, parts.length - 1);
}
export function query(root, selector) {
  const parsed = selectors().astSync(selector);
  return descendants(root).filter(node => parsed.nodes.some(s => matches(node, s)));
}
export function scopedDeclarations(css) {
  const parsed = postcss.parse(css), rules = [];
  parsed.walkRules(rule => {
    let maxWidth = Infinity;
    for (let parent = rule.parent; parent; parent = parent.parent) if (parent.type === 'atrule') {
      if (parent.name === 'media') {
        const match = /^\(max-width:\s*(\d+)px\)$/.exec(parent.params);
        assert.ok(match, 'supported explicit viewport condition'); maxWidth = Math.min(maxWidth, Number(match[1]));
      } else assert.equal(parent.name, 'layer');
    }
    rules.push({ selectors: selectors().astSync(rule.selector), maxWidth,
      declarations: rule.nodes.filter(n => n.type === 'decl').map(n => ({ prop: n.prop, value: n.value, important: Boolean(n.important) })) });
  });
  return (node, width) => {
    const result = {}, priorities = {};
    for (const rule of rules) if (width <= rule.maxWidth && rule.selectors.nodes.some(s => matches(node, s))) {
      for (const d of rule.declarations) if (!priorities[d.prop] || d.important) {
        result[d.prop] = d.value; priorities[d.prop] = d.important;
      }
    }
    return result;
  };
}
