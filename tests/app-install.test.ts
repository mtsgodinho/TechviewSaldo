import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import manifest from '../app/manifest';
import {readFile} from 'node:fs/promises';
test('install manifest launches the authenticated app root with standalone display and standard icons',()=>{
 const m=manifest();assert.equal(m.start_url,'/');assert.equal(m.scope,'/');assert.equal(m.id,'/');assert.equal(m.display,'standalone');assert.equal(m.name,'TechView Saldo');
 assert.deepEqual(m.icons?.map(i=>i.sizes),['192x192','512x512']);assert.ok(m.icons?.every(i=>i.type==='image/png'&&i.src.startsWith('/icons/techview-')));
});
test('published TechView symbol has the exact home screen PNG dimensions',async()=>{
 for(const size of [180,192,512]){const bytes=await readFile(`public/icons/techview-${size}.png`);const meta=await sharp(bytes).metadata();assert.equal(meta.width,size);assert.equal(meta.height,size);assert.equal(meta.format,'png');}
});
