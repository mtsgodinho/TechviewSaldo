import {test} from 'node:test';
import assert from 'node:assert/strict';
import {presetPeriod,validatePeriod} from '../lib/meta-period';
import {readCampaignReport} from '../lib/meta-report';
const now=new Date('2026-10-29T01:00:00Z');
test('presets use São Paulo day, inclusive intervals and Monday week',()=>{
 assert.deepEqual(presetPeriod('today',now),{since:'2026-10-28',until:'2026-10-28'});
 assert.deepEqual(presetPeriod('yesterday',now),{since:'2026-10-27',until:'2026-10-27'});
 assert.deepEqual(presetPeriod('week',now),{since:'2026-10-26',until:'2026-10-28'});
 for(const [p,since]of [['7','2026-10-22'],['15','2026-10-14'],['30','2026-09-29'],['month','2026-10-01']] as const)assert.deepEqual(presetPeriod(p,now),{since,until:'2026-10-28'});
 assert.deepEqual(presetPeriod('week',new Date('2026-11-01T15:00:00Z')),{since:'2026-10-26',until:'2026-11-01'});
 assert.deepEqual(presetPeriod('yesterday',new Date('2026-03-01T15:00:00Z')),{since:'2026-02-28',until:'2026-02-28'});
});
test('custom period rejects invalid, reversed, future and unsupported old dates',()=>{
 assert.deepEqual(validatePeriod('2026-09-01','2026-09-30',now),{since:'2026-09-01',until:'2026-09-30'});
 for(const dates of [['2026-02-30','2026-03-01'],['2026-10-28','2026-10-27'],['2026-10-28','2026-10-29'],['2020-01-01','2026-10-28'],['invalid','2026-10-28']])assert.throws(()=>validatePeriod(dates[0],dates[1],now));
});
test('historical reports query only supplied authorized campaigns and do not subtract a baseline',async()=>{
 const calls:string[]=[];const period={since:'2026-09-01',until:'2026-09-30'};
 const rows=await readCampaignReport([{id:'123',account_id:'456'}],'456',period,async(id,range)=>{calls.push(id);assert.deepEqual(range,period);return {data:[{spend:'14.52',impressions:'592',clicks:'14'}]};});
 assert.deepEqual(calls,['123']);assert.deepEqual(rows,[{id:'123',spend_cents:1452,impressions:592,clicks:14,sales:0,sale_event:null}]);
 await assert.rejects(readCampaignReport([{id:'999',account_id:'other'}],'456',period,async()=>{throw new Error('must not query')}),/outra conta/);
 assert.deepEqual(await readCampaignReport([],'456',period,async()=>{throw new Error('must not query')}),[]);
 assert.deepEqual(await readCampaignReport([{id:'123',account_id:'456'}],'456',period,async()=>({data:[]})),[{id:'123',spend_cents:0,impressions:0,clicks:0,sales:0,sale_event:null}]);
});

test('campaign sales use attributed purchases without duplicating event families or treating other actions as sales',async()=>{
 const period={since:'2026-10-01',until:'2026-10-28'};
 const rows=await readCampaignReport([{id:'123',account_id:'456'},{id:'789',account_id:'456'}],'456',period,async(id,range)=>{
  assert.deepEqual(range,period);
  return {data:[{actions:id==='123'?[{action_type:'omni_purchase',value:'4'},{action_type:'purchase',value:'4'},{action_type:'offsite_conversion.fb_pixel_purchase',value:'4'}]:[{action_type:'lead',value:'12'},{action_type:'link_click',value:'25'},{action_type:'offsite_conversion.fb_pixel_add_to_cart',value:'3'}]}]};
 });
 assert.equal(rows[0].sales,4);assert.equal(rows[0].sale_event,'omni_purchase');assert.equal(rows[1].sales,0);assert.equal(rows[1].sale_event,null);
 await assert.rejects(readCampaignReport([{id:'123',account_id:'456'}],'456',period,async()=>{throw new Error('Meta indisponível')}),/indisponível/);
 await assert.rejects(readCampaignReport([{id:'123',account_id:'456'}],'456',period,async()=>({data:[{actions:[{action_type:'purchase',value:'NaN'}]}]})),/inválida/);
});
