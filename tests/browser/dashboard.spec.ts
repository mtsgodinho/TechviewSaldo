import {test,expect,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {pixPayload} from '../../lib/pix';
import QRCode from 'qrcode';
const client='22222222-2222-4222-8222-222222222222',admin='11111111-1111-4111-8111-111111111111';
const profiles=[{id:client,name:'Cliente de teste',role:'client',active:true},{id:admin,name:'Administrador de teste',role:'admin',active:true}];
const fixture={profiles,clients:[{id:client,email:'cliente@example.com',phone:'11999999999',created_at:'2026-10-28T12:00:00Z'}],wallets:[{client_id:client,balance_cents:25000}],transactions:[],requests:[],settings:{pix_key:'pix@example.com',receiver_name:'TECHVIEW TESTE',city:'SAO PAULO',bank:'Nubank',minimum_cents:100}};
async function mount(page:Page,role:'admin'|'client'){
 const r=await page.request.get('/');const html=await r.text();const css=[...html.matchAll(/<link[^>]+href="([^"]+\.css[^\"]*)"[^>]*>/g)].map(m=>`<link rel="stylesheet" href="${m[1]}">`).join('');
 const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Dashboard from './components/dashboard';createRoot(document.getElementById('root')).render(<Dashboard data={${JSON.stringify({...fixture,profile:profiles.find(p=>p.role===role)})}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'router-test',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'router',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const useRouter=()=>({refresh(){}});'}));}}]});
 await page.route('**/__ui-test',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html lang="pt-BR"><head>${css}</head><body><div id="root"></div></body></html>`}));
 await page.goto('/__ui-test');await page.addScriptTag({content:bundle.outputFiles[0].text});
}
for(const width of [1440,390]){
 test(`client chooses Pix amount and reports payment without credit ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});await mount(page,'client');
 const payload=pixPayload({key:'pix@example.com',name:'TECHVIEW TESTE',city:'SAO PAULO',cents:15009,txid:'TESTE123'});
 const calls:Record<string,unknown>[]=[];
 await page.route('**/api/action',async r=>{const body=r.request().postDataJSON();calls.push(body);await r.fulfill({json:body.action==='pix'?{ok:true,request:{id:'66666666-6666-4666-8666-666666666666',client_id:client,amount_cents:15009,status:'awaiting',txid:'TESTE123',payload,receiver_name:'TECHVIEW TESTE',bank:'Nubank',created_at:new Date().toISOString(),qr:await QRCode.toDataURL(payload)}}:{ok:true}})});
 await expect(page.getByRole('heading',{name:'Olá, Cliente 👋'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/techview-dashboard-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Adicionar saldo',exact:true}).first().click();await page.getByLabel('Ou digite outro valor (R$)').fill('150,09');await page.getByRole('button',{name:'Gerar QR Code Pix'}).click();
 await expect(page.getByRole('heading',{name:'R$ 150,09'})).toBeVisible();await expect(page.getByAltText('QR Code Pix com valor e recebedor')).toBeVisible();await expect(page.getByRole('textbox',{name:'Pix copia e cola'})).toHaveValue(payload);
 await page.getByRole('button',{name:'Já realizei o pagamento'}).click();await expect(page.getByText('Recebemos sua informação.',{exact:false})).toBeVisible();expect(calls.map(c=>c.action)).toEqual(['pix','inform']);await page.getByRole('button',{name:'Fechar',exact:true}).click();await expect(page.locator('.balance-value')).toHaveText('R$ 250,00');
 });
}
test('administrator manages client, records Meta Ads and tests Pix settings',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await mount(page,'admin');let body:Record<string,unknown>={};await page.route('**/api/action',async r=>{body=r.request().postDataJSON();await r.fulfill({json:{ok:true}})});
 await page.getByRole('button',{name:'Clientes',exact:true}).click();await page.getByPlaceholder('Pesquisar por nome ou e-mail').fill('cliente@example.com');await page.getByRole('button',{name:'Gerenciar',exact:true}).click();await page.getByRole('button',{name:'Ajustar saldo / Meta Ads'}).click();await page.getByLabel('Valor (R$)').fill('150,00');await page.getByLabel('Motivo / descrição').fill('Recarga anúncios de teste');await page.getByRole('button',{name:'Salvar',exact:true}).click();await expect(page.getByRole('status')).toContainText('Operação concluída');expect(body.action).toBe('adjust');expect(body.type).toBe('meta_ads');expect(body.client_id).toBe(client);expect(body.operation).toMatch(/^[0-9a-f-]{36}$/);
 await page.getByRole('button',{name:'Configurações Pix',exact:true}).click();await page.getByRole('button',{name:'Testar QR Code'}).click();await expect(page.getByAltText('QR Code Pix com valor e recebedor')).toBeVisible();await expect(page.getByRole('textbox',{name:'Pix copia e cola'})).toHaveValue(pixPayload({key:'pix@example.com',name:'TECHVIEW TESTE',city:'SAO PAULO',cents:100,txid:'TESTE'}));
});
