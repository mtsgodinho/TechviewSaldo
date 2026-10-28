import {test} from 'node:test';import assert from 'node:assert/strict';import {taxCents,campaignBill} from '../lib/meta-billing';
test('12 percent is rounded on cumulative campaign spend, in cents',()=>{assert.equal(taxCents(10000),1200);assert.equal(taxCents(1353),162);assert.equal(taxCents(5),1);assert.equal(taxCents(4),0);assert.throws(()=>taxCents(-1));assert.deepEqual(campaignBill({observed_cents:1353,baseline_cents:0,charged_cents:18}),{spend:1353,tax:162,total:1515,pending:1497});});
import {netWalletBalance} from '../lib/meta-billing';
test('net wallet displays individual debt including tax and remains stable during settlement',()=>{
 const alexandre={observed_cents:1962,baseline_cents:0,charged_cents:0};
 const mateus={observed_cents:1573,baseline_cents:0,charged_cents:0};
 assert.equal(netWalletBalance(0,[alexandre]),-2197);assert.equal(netWalletBalance(0,[mateus]),-1762);
 assert.equal(netWalletBalance(7108,[{observed_cents:1689,baseline_cents:0,charged_cents:1892}]),7108);
 // Uma recarga cobre a dívida uma vez: antes e depois do lançamento têm o mesmo líquido.
 assert.equal(netWalletBalance(3000,[alexandre]),803);
 assert.equal(netWalletBalance(803,[{...alexandre,charged_cents:2197}]),803);
 assert.equal(netWalletBalance(1000,[alexandre]),-1197);
 assert.equal(netWalletBalance(0,[{...alexandre,charged_cents:1000}]),-1197);
 assert.equal(netWalletBalance(2197,[alexandre]),0);assert.equal(netWalletBalance(0,[]),0);
});
