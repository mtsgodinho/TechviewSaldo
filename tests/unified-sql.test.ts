import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const admin='11111111-1111-4111-8111-111111111111',client='22222222-2222-4222-8222-222222222222';
for(const state of ['base','meta002','meta003','monthly005','polygon006'] as const)test(`unified SQL upgrades ${state} and does not double charge on repeat`,async()=>{
 const db=new PGlite();await db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
 await db.exec(`insert into auth.users values('${admin}'),('${client}');insert into profiles(id,name,role) values('${admin}','Admin','admin'),('${client}','Cliente','client');insert into clients(id,email) values('${client}','cliente@example.com');insert into wallets values('${client}',9000);`);
 if(state!=='base'){
  await db.exec(await readFile(new URL('../supabase/migrations/002_meta.sql',import.meta.url),'utf8'));
  await db.exec(`select bind_meta_campaign('123','456','${client}','Campanha','2026-10-28',1335,100,2,now()-interval '5 minutes','${admin}');select apply_meta_snapshot('123',1353,105,2,now())`);
 }
 if(state==='meta003'||(state==='monthly005'||state==='polygon006'))await db.exec(await readFile(new URL('../supabase/migrations/003_meta_activation_day.sql',import.meta.url),'utf8'));
 if((state==='monthly005'||state==='polygon006')){await db.exec(await readFile(new URL('../supabase/migrations/004_profiles_brand.sql',import.meta.url),'utf8'));await db.exec(await readFile(new URL('../supabase/migrations/005_monthly_fees.sql',import.meta.url),'utf8'));await db.exec(`insert into monthly_settings(client_id,amount_cents,updated_by) values('${client}',15000,'${admin}')`);}
 if(state==='polygon006'){await db.exec(await readFile(new URL('../supabase/migrations/006_polygon_usdt.sql',import.meta.url),'utf8'));await db.exec(`set request.jwt.claim.sub='${admin}';select save_polygon_settings('0x52908400098527886E0F7030069857D2E4169EE7',5500000,100,true);select create_polygon_request('${client}',10000)`);}
 const sql=await readFile(new URL('../supabase/ATUALIZACAO_UNICA.sql',import.meta.url),'utf8');await db.exec(sql);
 if(state==='base')await db.exec(`select bind_meta_campaign('123','456','${client}','Campanha','2026-10-28',1353,105,2,now(),'${admin}')`);
 const balance=async()=>Number((await db.query<{balance_cents:number}>('select balance_cents from wallets')).rows[0].balance_cents);
 assert.equal(await balance(),7485);const count=(await db.query('select * from wallet_transactions')).rows.length;
 await db.exec(sql);assert.equal(await balance(),7485);assert.equal((await db.query('select * from wallet_transactions')).rows.length,count);
 assert.equal((await db.query('select * from clients')).rows.length,1);assert.equal((await db.query('select * from monthly_settings')).rows.length,(state==='monthly005'||state==='polygon006')?1:0);assert.equal((await db.query('select * from monthly_cycles')).rows.length,0);assert.equal((await db.query('select * from polygon_requests')).rows.length,state==='polygon006'?1:0);assert.equal((await db.query('select * from polygon_settings')).rows.length,state==='polygon006'?1:0);if(state==='polygon006')assert.equal(Number((await db.query<{rate_micro_brl:number}>('select rate_micro_brl from polygon_requests')).rows[0].rate_micro_brl),5500000);await db.close();
});
