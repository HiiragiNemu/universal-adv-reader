import test from 'node:test';
import assert from 'node:assert/strict';
import { boundViewportFilter } from './viewport-filter.ts';

class Primitive {
  attributes = new Map<string,string>();
  children: Primitive[] = [];
  setAttribute(key:string,value:string) { this.attributes.set(key,value); }
}
test('all primitive subregions use identical native CSS viewport dimensions', () => {
  const root = new Primitive(); root.children=[new Primitive(),new Primitive(),new Primitive()];
  root.children[1].setAttribute('stdDeviation','22');
  boundViewportFilter(root as unknown as SVGFilterElement,393,820);
  for(const p of [root,...root.children]) {
    assert.equal(p.attributes.get('x'),'0');assert.equal(p.attributes.get('y'),'0');
    assert.equal(p.attributes.get('width'),'393');assert.equal(p.attributes.get('height'),'820');
  }
  assert.equal(root.attributes.get('filterUnits'),'userSpaceOnUse');
  assert.equal(root.children[1].attributes.get('stdDeviation'),'22');
  boundViewportFilter(root as unknown as SVGFilterElement,1440,900);
  assert.equal(root.children[2].attributes.get('width'),'1440');
  boundViewportFilter(root as unknown as SVGFilterElement,0,0);
  assert.equal(root.children[2].attributes.get('width'),'1440');
});
