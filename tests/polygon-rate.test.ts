import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {readPolygonRate,fetchPolygonRate,RATE_SOURCE} from '../lib/polygon-rate';
import {quotedUSDT} from '../lib/polygon';
const now=1793214000000;
const payload={USDBRL:{code:'USD',codein:'BRL',bid:'5.12345678',timestamp:String(now/1000)}};
test('USD/BRL quote uses exact micro-reais and rejects stale, future, incorrect or unavailable data',async()=>{
 const rate=readPolygonRate(payload,now);assert.equal(rate.rate_micro_brl,5123457);assert.equal(rate.source,RATE_SOURCE);assert.equal(rate.quoted_at,new Date(now).toISOString());
 for(const change of [{bid:'0'},{bid:'1e3'},{bid:'-1'},{bid:'5.123456789'},{code:'USDT'},{codein:'USD'},{timestamp:String(now/1000-601)},{timestamp:String(now/1000+16)},{timestamp:now/1000}])assert.throws(()=>readPolygonRate({USDBRL:{...payload.USDBRL,...change}},now));
 for(const data of [null,{},[]])assert.throws(()=>readPolygonRate(data,now));
 const latest={USDBRL:{...payload.USDBRL,timestamp:String(Math.floor(Date.now()/1000))}};
 let calls=0;await fetchPolygonRate((async(url,init)=>{calls++;assert.equal(String(url),'https://economia.awesomeapi.com.br/json/last/USD-BRL');assert.equal(init?.cache,'no-store');assert.ok(init?.signal);return Response.json(latest)}) as typeof fetch);assert.equal(calls,1);
 for(const fake of [async()=>new Response('',{status:429}),async()=>{throw new Error('timeout')},async()=>Response.json({USDBRL:{...payload.USDBRL,timestamp:String(Math.floor(Date.now()/1000)-3600)}}),async()=>Response.json({})])await assert.rejects(fetchPolygonRate(fake as typeof fetch),/indisponível ou desatualizada/);
});
test('automatic dollar quotes are server-only, preserve pending transfers and credit the exact BRL snapshot once',async()=>{
 const db=new PGlite(),admin='11111111-1111-4111-8111-111111111111',client='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';const address='0x52908400098527886E0F7030069857D2E4169EE7',hash='0x'+'ab'.repeat(32);
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 await db.exec(await readFile('supabase/schema.sql','utf8'));await db.exec(await readFile('supabase/migrations/006_polygon_usdt.sql','utf8'));
 await db.exec(`insert into auth.users values('${admin}'),('${client}'),('${other}');insert into profiles(id,name,role) values('${admin}','Admin','admin');set role authenticated;set request.jwt.claim.sub='${admin}';select register_client('${client}','Cliente','cliente@example.com','');select register_client('${other}','Outro','outro@example.com','');select save_polygon_settings('${address}',5500000,100,true);set request.jwt.claim.sub='${client}';`);
 const old=(await db.query<{id:string}>(`select * from create_polygon_request('${client}',10000)`)).rows[0];await db.exec('reset role');await db.exec(await readFile('supabase/migrations/007_polygon_live_rate.sql','utf8'));
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${client}';`);await assert.rejects(db.exec(`select create_polygon_request('${client}',10000)`),/permission denied/);await assert.rejects(db.exec(`select create_polygon_request_at_rate('${client}','${client}',10000,1,now(),'${RATE_SOURCE}')`),/permission denied/);await assert.rejects(db.exec(`select configure_polygon_receiving('${address}',100,true)`),/Acesso não autorizado/);
 await db.exec('set role service_role');
 const create=async(actor:string,target:string,cents:number,rate:number,stamp="clock_timestamp()",source=RATE_SOURCE)=>(await db.query<{id:string;amount_cents:number;rate_micro_brl:number;amount_units:string;rate_source:string}>(`select * from create_polygon_request_at_rate('${actor}','${target}',${cents},${rate},${stamp},'${source}')`)).rows[0];
 const preserved=await create(client,client,20000,6000000);assert.equal(preserved.id,old.id);assert.equal(Number(preserved.rate_micro_brl),5500000);
 await assert.rejects(create(client,other,10000,5500000),/Acesso não autorizado/);await assert.rejects(create(other,other,10000,5500000,"clock_timestamp()-interval '11 minutes'"),/Cotação inválida/);await assert.rejects(create(other,other,10000,5500000,"clock_timestamp()+interval '1 minute'"),/Cotação inválida/);await assert.rejects(create(other,other,10000,5500000,'clock_timestamp()','client value'),/Cotação inválida/);
 const live=await create(other,other,10000,5123457);assert.equal(live.amount_units,quotedUSDT(10000,5123457));assert.equal(live.rate_source,RATE_SOURCE);assert.equal((await create(other,other,20000,6000000)).id,live.id);
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${other}';select inform_polygon_payment('${live.id}','${hash}');set request.jwt.claim.sub='${admin}';select configure_polygon_receiving('${address}',100,false);select review_polygon_payment('${live.id}',true,'${hash}');select review_polygon_payment('${live.id}',true,'${hash}');`);
 const wallet=(await db.query<{balance_cents:number}>(`select balance_cents from wallets where client_id='${other}'`)).rows[0];assert.equal(Number(wallet.balance_cents),10000);assert.equal((await db.query(`select * from wallet_transactions where polygon_request_id='${live.id}'`)).rows.length,1);
 await db.exec(`select configure_polygon_receiving('${address}',100,true);select review_polygon_payment('${old.id}',false,null);set role service_role;`);await assert.rejects(create(other,client,10000,1),/Acesso não autorizado/);
 // An administrator may create a quote for a client, but cannot bypass activity checks.
 const next=await create(admin,client,12345,5678912);assert.equal(next.amount_units,quotedUSDT(12345,5678912));await db.exec(`reset role;update profiles set active=false where id='${other}';set role service_role;`);await assert.rejects(create(other,other,10000,1),/Acesso não autorizado/);await db.close();
});
