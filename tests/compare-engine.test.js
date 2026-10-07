import test from 'node:test';
import assert from 'node:assert/strict';
import { splitRefDes, deriveScope, compareBom, parseRdMatrices } from '../src/compare-engine.js';

test('split Ref Des and expand simple ranges', () => {
  assert.deepEqual(splitRefDes('R1,R3; C1 C2'), ['R1','R3','C1','C2']);
  assert.deepEqual(splitRefDes('Q1-Q3'), ['Q1','Q2','Q3']);
});

test('derive 8C / 8D scope from parent part number', () => {
  assert.equal(deriveScope('8C8783B1030E'), '8C');
  assert.equal(deriveScope('8D123456'), '8D');
});

test('RD side-by-side Add/Delete parser', () => {
  const rows = [
    ['刪除','','','','','','新增','','','',''],
    ['位階','插件位置','料號','品名','數量','','位階','插件位置','料號','品名','數量'],
    ['8C','Q1','OLD001','Old part',1,'','8C','Q1','NEW001','New part',1],
    ['8D','C2','OLD002','Old 8D',1,'','8D','C2','NEW002','New 8D',1],
  ];
  const parsed = parseRdMatrices([{name:'RD',rows}]);
  assert.equal(parsed.changes.length, 4);
  assert.equal(parsed.changes.filter(x=>x.action==='ADD').length, 2);
  assert.equal(parsed.changes.filter(x=>x.action==='DELETE').length, 2);
});

test('compare ADD, DELETE and OUT OF SCOPE', () => {
  const rd = [
    {action:'DELETE',scope:'8C',refDes:['Q1'],partNumber:'OLD001',qty:1},
    {action:'ADD',scope:'8C',refDes:['Q1'],partNumber:'NEW001',qty:1},
    {action:'ADD',scope:'8C',refDes:['C3','EC1'],partNumber:'CAP001',qty:2},
    {action:'ADD',scope:'8D',refDes:['X1'],partNumber:'OTHER',qty:1}
  ];
  const agile = {
    scope:'8C',
    lines:[
      {partNumber:'NEW001',refDes:['Q1'],qty:1},
      {partNumber:'CAP001',refDes:['C3','EC1'],qty:2}
    ]
  };
  const out = compareBom(rd, agile);
  assert.equal(out.summary.PASS, 3);
  assert.equal(out.summary.OUT_OF_SCOPE, 1);
  assert.equal(out.summary.FAIL, 0);
});

test('wrong part is FAIL', () => {
  const out = compareBom(
    [{action:'ADD',scope:'8C',refDes:['Q14'],partNumber:'EXPECTED',qty:1}],
    {scope:'8C',lines:[{partNumber:'WRONG',refDes:['Q14'],qty:1}]}
  );
  assert.equal(out.summary.FAIL, 1);
});
