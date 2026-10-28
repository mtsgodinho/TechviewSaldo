import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {polygonAddress,transactionHash,parseRate,formatRate,quotedUSDT,formatUSDT,polygonTransactionUrl} from '../lib/polygon';
const admin='11111111-1111-4111-8111-111111111111',client='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
const address='0x52908400098527886E0F7030069857D2E4169EE7',sender='0xde709f2102306220921060314715629080e2fb77',hash='0x'+'ab'.repeat(32),hash2='0x'+'cd'.repeat(32);
test('USDT rates, six-decimal quantities and address/hash validation use exact units',()=>{
 assert.equal(polygonAddress(address.toLowerCase()),address);for(const invalid of ['0x'+'0'.repeat(40),'not an address','0x'+'ab'.repeat(32),address.slice(0,-1),'0x52908400098527886e0F7030069857D2E4169EE7'])assert.throws(()=>polygonAddress(invalid));
 assert.equal(transactionHash(hash.toUpperCase().replace('0X','0x')),hash);assert.equal(polygonTransactionUrl(hash),'https://polygonscan.com/tx/'+hash);for(const invalid of ['0x'+'0'.repeat(64),'https://example.com',hash.slice(0,-1)])assert.throws(()=>transactionHash(invalid));
 assert.equal(parseRate('5,500000'),5500000);assert.equal(parseRate('0.000001'),1);assert.equal(formatRate(5500000),'5.5');assert.equal(formatRate(1),'0.000001');assert.equal(quotedUSDT(10000,5500000),'18181819');assert.equal(formatUSDT('18181819'),'18.181819');
 for(const invalid of ['0','-1','1.0000001','1e3','NaN'])assert.throws(()=>parseRate(invalid));
 for(const [cents,rate]of [[1,1],[1,5500000],[99999999,1],[12345,5678912],[99999999,999999999999]]){const units=BigInt(quotedUSDT(cents,rate)),target=BigInt(cents)*10000000000n;assert.ok(units*BigInt(rate)>=target);assert.ok((units-1n)*BigInt(rate)<target);}
});
test('Polygon confirmation credits only its client once, preserves quotes, deduplicates hashes and enforces RLS',async()=>{
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 await db.exec(await readFile('supabase/schema.sql','utf8'));await db.exec(await readFile('supabase/migrations/006_polygon_usdt.sql','utf8'));
 await db.exec(`insert into auth.users values('${admin}'),('${client}'),('${other}');insert into profiles(id,name,role) values('${admin}','Admin','admin');set role authenticated;set request.jwt.claim.sub='${admin}';select register_client('${client}','Cliente','cliente@example.com','');select register_client('${other}','Outro','outro@example.com','');select save_polygon_settings('${address}',5500000,100,true);`);
 async function request(id:string,cents:number){return (await db.query<{id:string;amount_cents:number;rate_micro_brl:number;amount_units:string;recipient_address:string}>(`select * from create_polygon_request('${id}',${cents})`)).rows[0];}
 const balance=async(id:string)=>Number((await db.query<{balance_cents:number}>(`select balance_cents from wallets where client_id='${id}'`)).rows[0].balance_cents);
 await db.exec(`set request.jwt.claim.sub='${client}'`);const first=await request(client,10000);assert.equal(first.amount_units,'18181819');assert.equal((await request(client,20000)).id,first.id);assert.equal(await balance(client),0);
 await assert.rejects(request(other,10000),/Acesso não autorizado/);await assert.rejects(db.exec(`select save_polygon_settings('${address}',1,100,true)`),/Acesso não autorizado/);await assert.rejects(db.exec(`update polygon_requests set status='confirmed'`),/permission denied/);
 await db.exec(`select inform_polygon_payment('${first.id}','${hash}');select inform_polygon_payment('${first.id}','${hash}');`);assert.equal(await balance(client),0);
 await assert.rejects(db.exec(`select inform_polygon_payment('${first.id}','${hash2}')`),/já analisada ou informada/);await assert.rejects(db.exec(`select review_polygon_payment('${first.id}',true,'${hash}')`),/Acesso não autorizado/);await assert.rejects(db.exec(`select cancel_polygon_request('${first.id}')`),/Somente solicitações próprias/);
 await db.exec(`set request.jwt.claim.sub='${other}'`);assert.equal((await db.query('select * from polygon_requests')).rows.length,0);await assert.rejects(db.exec(`select inform_polygon_payment('${first.id}','${hash}')`),/não encontrada/);
 const duplicate=await request(other,20000);await db.exec(`select inform_polygon_payment('${duplicate.id}','${hash}');set request.jwt.claim.sub='${admin}';select save_polygon_settings('${sender}',6000000,100,false);`);
 await assert.rejects(db.exec(`select review_polygon_payment('${first.id}',true,'${hash2}')`),/Confira novamente/);assert.equal(await balance(client),0);
 await db.exec(`select review_polygon_payment('${first.id}',true,'${hash}');select review_polygon_payment('${first.id}',true,'${hash}');select review_polygon_payment('${first.id}',false,null);`);
 assert.equal(await balance(client),10000);assert.equal(await balance(other),0);const confirmed=(await db.query<{recipient_address:string;rate_micro_brl:number}>(`select recipient_address,rate_micro_brl from polygon_requests where id='${first.id}'`)).rows[0];assert.equal(confirmed.recipient_address,address);assert.equal(Number(confirmed.rate_micro_brl),5500000);
 await assert.rejects(db.exec(`select review_polygon_payment('${duplicate.id}',true,'${hash}')`),/já foi creditada/);assert.equal(await balance(other),0);assert.equal((await db.query('select * from wallet_transactions')).rows.length,1);
 await db.exec(`select review_polygon_payment('${duplicate.id}',false,null);set request.jwt.claim.sub='${other}';`);await assert.rejects(request(other,20000),/não está habilitado/);
 await db.exec(`set request.jwt.claim.sub='${admin}';select save_polygon_settings('${address}',5500000,100,true);set request.jwt.claim.sub='${other}';`);const cancelled=await request(other,20000);await db.exec(`select cancel_polygon_request('${cancelled.id}')`);assert.equal(await balance(other),0);
 const next=await request(other,20000);assert.notEqual(next.id,cancelled.id);await db.exec(`select inform_polygon_payment('${next.id}','${hash2}');set request.jwt.claim.sub='${admin}';select review_polygon_payment('${next.id}',true,'${hash2}');`);assert.equal(await balance(other),20000);assert.equal(await balance(client),10000);
 assert.equal((await db.query('select * from pix_requests')).rows.length,0);assert.equal((await db.query('select * from wallet_transactions where polygon_request_id is not null')).rows.length,2);
 for(const cents of [1,100,12345,99999999]){await db.exec(`select save_polygon_settings('${address}',5678912,1,true)`);const r=await request(client,cents);assert.equal(r.amount_units,quotedUSDT(cents,5678912));await db.exec(`select review_polygon_payment('${r.id}',false,null)`);}
 await db.close();
});
