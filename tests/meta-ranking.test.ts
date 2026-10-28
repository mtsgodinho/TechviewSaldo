import {test} from 'node:test';import assert from 'node:assert/strict';import {attributedEvents,readRanking,conversion,orderRanking} from '../lib/meta-ranking';
test('attributed events select one aggregate and never count clicks or messages as leads',()=>{
 const a=attributedEvents([{action_type:'lead',value:'10'},{action_type:'offsite_conversion.fb_pixel_lead',value:'10'},{action_type:'omni_purchase',value:'4'},{action_type:'purchase',value:'4'},{action_type:'offsite_conversion.fb_pixel_purchase',value:'4'}]);assert.equal(a.leads.count,10);assert.equal(a.sales.count,4);
 const b=attributedEvents([{action_type:'link_click',value:'50'},{action_type:'onsite_conversion.messaging_conversation_started_7d',value:'20'}]);assert.equal(b.leads.count,0);assert.equal(b.sales.count,0);assert.equal(b.leads.event,null);
 assert.equal(attributedEvents([{action_type:'offsite_conversion.fb_pixel_purchase',value:'2.5'}]).sales.count,2.5);assert.throws(()=>attributedEvents([{action_type:'lead',value:'NaN'}]));assert.equal(conversion({leads:0,sales:5}),null);
});
test('ranking aggregates campaigns by client, sorts sales and rejects duplicates',async()=>{
 const clients=[{id:'a',name:'Ana'},{id:'b',name:'Bruno'},{id:'c',name:'Sem campanha'}],period={since:'2026-10-01',until:'2026-10-28'},campaigns=[{id:'1',account_id:'123',client_id:'a'},{id:'2',account_id:'123',client_id:'a'},{id:'3',account_id:'123',client_id:'b'}];
 const rows=await readRanking(clients,campaigns,'123',period,async(id,p)=>{assert.deepEqual(p,period);return {data:[{spend:'10.00',actions:[{action_type:'lead',value:id==='3'?'10':'3'},{action_type:'omni_purchase',value:id==='3'?'5':'2'}]}]};});
 assert.equal(rows[0].id,'b');assert.equal(rows[0].sales,5);assert.equal(rows[1].sales,4);assert.equal(rows[1].leads,6);assert.equal(rows[1].spend_cents,2000);assert.equal(rows[2].campaigns,0);assert.equal(conversion(rows[0]),50);assert.equal(orderRanking(rows,'leads')[0].id,'b');
 await assert.rejects(readRanking(clients,[...campaigns,campaigns[0]],'123',period,async()=>({data:[]})),/duplicada/);
 await assert.rejects(readRanking(clients,[{id:'4',account_id:'999',client_id:'a'}],'123',period,async()=>({data:[]})),/inconsistentes/);
 await assert.rejects(readRanking(clients,campaigns,'123',period,async()=>{throw new Error('Meta indisponível')}),/indisponível/);
});
