import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';import sharp from 'sharp';import {normalizeImage,MAX_MEDIA_BYTES} from '../lib/media';
const admin='11111111-1111-4111-8111-111111111111',client='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
test('self profile RPC cannot change another identity, role, wallet or brand; avatar stays scoped',async()=>{
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));await db.exec(await readFile(new URL('../supabase/migrations/004_profiles_brand.sql',import.meta.url),'utf8'));
 await db.exec(`insert into auth.users values('${admin}'),('${client}'),('${other}');insert into profiles(id,name,role) values('${admin}','Admin','admin');set role authenticated;set request.jwt.claim.sub='${admin}';select register_client('${client}','Cliente','cliente@example.com','');select register_client('${other}','Outro','outro@example.com','');set request.jwt.claim.sub='${client}';select update_own_profile('Nome atualizado','11999999999');select set_own_avatar('${client}/44444444-4444-4444-8444-444444444444.webp');`);
 const profile=(await db.query<{name:string;role:string;phone:string}>('select * from profiles')).rows[0];assert.equal(profile.name,'Nome atualizado');assert.equal(profile.role,'client');assert.equal(profile.phone,'11999999999');assert.equal((await db.query('select * from wallets')).rows.length,1);
 await assert.rejects(db.exec(`select set_own_avatar('${other}/44444444-4444-4444-8444-444444444444.webp')`),/Foto inválida/);
 await assert.rejects(db.exec(`update profiles set role='admin'`),/permission denied/);
 await assert.rejects(db.exec(`select set_brand_logo('brand/44444444-4444-4444-8444-444444444444.webp')`),/Acesso não autorizado/);
 await db.exec(`set request.jwt.claim.sub='${admin}';select set_brand_logo('brand/44444444-4444-4444-8444-444444444444.webp');select edit_client('${client}','Cliente','',false);set request.jwt.claim.sub='${client}';`);
 await assert.rejects(db.exec(`select update_own_profile('Bloqueado','')`),/Acesso não autorizado/);
 await db.exec('set role anon');assert.equal((await db.query('select logo_path from brand_settings')).rows.length,1);await assert.rejects(db.exec(`select update_own_profile('Anônimo','')`),/permission denied/);
 await db.close();
});
test('avatar normalization sanitizes raster images; logo preserves aspect ratio',async()=>{
 const png=await sharp({create:{width:900,height:600,channels:3,background:'#008cff'}}).withMetadata({orientation:1}).png().toBuffer();
 assert.ok((await sharp(png).metadata()).exif);const avatar=await normalizeImage(png,'avatar');const a=await sharp(avatar).metadata();assert.equal(a.format,'webp');assert.equal(a.width,512);assert.equal(a.height,512);assert.equal(a.exif,undefined);
 const logo=await normalizeImage(png,'logo');const l=await sharp(logo).metadata();assert.equal(l.width,900);assert.equal(l.height,600);
 await assert.rejects(normalizeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'),'avatar'),/JPG, PNG ou WebP/);
 await assert.rejects(normalizeImage(new Uint8Array(MAX_MEDIA_BYTES+1),'avatar'),/4 MB/);
});
