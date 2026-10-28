import {test} from 'node:test';
import assert from 'node:assert/strict';
import {metaCents,counter,accountDate} from '../lib/meta-values';
test('Meta amounts use exact cents and reject malformed values',()=>{assert.equal(metaCents('123.45'),12345);assert.equal(metaCents('0.01'),1);assert.equal(metaCents('17'),1700);for(const v of ['-1','1.001','1,00','NaN','1e3',''])assert.throws(()=>metaCents(v));});
test('Meta counters and account day honor São Paulo timezone',()=>{assert.equal(counter('42'),42);assert.equal(counter(undefined),0);assert.throws(()=>counter('-1'));assert.equal(accountDate(new Date('2026-10-29T01:00:00Z')),'2026-10-28');});
