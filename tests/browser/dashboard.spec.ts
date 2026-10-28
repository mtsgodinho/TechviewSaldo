import {test,expect,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {pixPayload} from '../../lib/pix';
import QRCode from 'qrcode';
const client='22222222-2222-4222-8222-222222222222',admin='11111111-1111-4111-8111-111111111111';
const profiles=[{id:client,name:'Cliente de teste',role:'client',active:true},{id:admin,name:'Administrador de teste',role:'admin',active:true}];
const fixture={profiles,clients:[{id:client,email:'cliente@example.com',phone:'11999999999',created_at:'2026-10-28T12:00:00Z'}],wallets:[{client_id:client,balance_cents:25000}],transactions:[],requests:[],settings:{pix_key:'pix@example.com',receiver_name:'TECHVIEW TESTE',city:'SAO PAULO',bank:'Nubank',minimum_cents:100}};
async function mount(page:Page,role:'admin'|'client',extra:Record<string,unknown>={}){
 const r=await page.request.get('/');const html=await r.text();const css=[...html.matchAll(/<link[^>]+href="([^"]+\.css[^\"]*)"[^>]*>/g)].map(m=>`<link rel="stylesheet" href="${m[1]}">`).join('');
 const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Dashboard from './components/dashboard';createRoot(document.getElementById('root')).render(<Dashboard data={${JSON.stringify({...fixture,...extra,profile:profiles.find(p=>p.role===role)})}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'router-test',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'router',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const useRouter=()=>({refresh(){}});'}));}}]});
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

for(const width of [1440,390]){
 test(`low balance warning and individual campaign metrics ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.route('**/api/meta*',r=>r.fulfill({json:r.request().method()==='GET'?{rows:[{id:'123',spend_cents:1353,impressions:443,clicks:3}],queried_at:new Date().toISOString()}:{ok:true,updated:0,failed:0,errors:[]}}));
 await mount(page,'client',{wallets:[{client_id:client,balance_cents:2000}],metaAvailable:true,campaigns:[{id:'123',account_id:'456',client_id:client,name:'Campanha exclusiva',started_on:'2026-10-28',bound_at:'2026-10-28T12:00:00Z',baseline_cents:50000,observed_cents:53000,charged_cents:3000,baseline_impressions:1000,baseline_clicks:10,impressions:1200,clicks:20,sampled_at:new Date().toISOString(),last_error:null}]});
 await expect(page.getByText('Seu saldo está baixo:',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Recarregar via Pix'})).toBeVisible();
 if(width===390)await page.getByRole('button',{name:'Abrir menu'}).click();
 await page.getByRole('button',{name:'Minhas campanhas',exact:true}).click();await expect(page.getByRole('heading',{name:'Campanhas Meta Ads'})).toBeVisible();await expect(page.getByText('Campanha exclusiva',{exact:true})).toBeVisible();await expect(page.getByText('R$ 13,53',{exact:true})).toHaveCount(3);await expect(page.locator('.tax-summary')).toContainText('R$ 1,62');await expect(page.locator('.tax-summary')).toContainText('R$ 15,15');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/techview-meta-${width}.png`,fullPage:true});
 });
}
test('administrator binds a remote campaign to the chosen client',async({page})=>{
 let submitted:Record<string,unknown>={};await page.route('**/api/meta*',r=>{if(r.request().url().includes('action=insights'))return r.fulfill({json:{rows:[],queried_at:new Date().toISOString()}});if(r.request().method()==='GET')return r.fulfill({json:{campaigns:[{id:'123',name:'Campanha nova'}]}});submitted=r.request().postDataJSON();return r.fulfill({json:{ok:true}})});
 await mount(page,'admin',{metaAvailable:true,campaigns:[]});await page.getByRole('button',{name:'Campanhas Meta',exact:true}).click();await page.getByRole('button',{name:'Buscar campanhas da Meta'}).click();await page.getByLabel('Campanha',{exact:true}).selectOption('123');await page.getByLabel('Cliente',{exact:true}).selectOption(client);await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Vincular campanha',exact:true}).click();await expect(page.getByRole('status')).toContainText('Campanha vinculada');expect(submitted).toEqual({action:'bind',campaign_id:'123',client_id:client});
});

test('historical shortcuts and custom dates read reports without triggering a debit',async({page})=>{
 const requests:{method:string;url:string}[]=[];
 await page.route('**/api/meta*',r=>{requests.push({method:r.request().method(),url:r.request().url()});return r.fulfill({json:{rows:[{id:'123',spend_cents:1452,impressions:592,clicks:14}],queried_at:new Date().toISOString()}})});
 await mount(page,'client',{metaAvailable:true,campaigns:[]});await page.getByRole('button',{name:'Minhas campanhas',exact:true}).click();
 await expect(page.getByRole('button',{name:'Hoje',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByText('R$ 14,52',{exact:true}).first()).toBeVisible();
 for(const name of ['Ontem','Esta semana','7 dias','15 dias','30 dias','Este mês']){
  await page.getByRole('button',{name,exact:true}).click();await expect(page.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByText('R$ 14,52',{exact:true}).first()).toBeVisible();
 }
 await page.getByLabel('Data inicial das métricas').fill('2026-09-01');await page.getByLabel('Data final das métricas').fill('2026-09-30');await page.getByRole('button',{name:'Aplicar período'}).click();await expect(page.getByText('R$ 14,52',{exact:true}).first()).toBeVisible();
 expect(requests.some(r=>r.url.includes('since=2026-09-01')&&r.url.includes('until=2026-09-30'))).toBe(true);expect(requests.every(r=>r.method==='GET'&&r.url.includes('action=insights'))).toBe(true);
 await page.getByLabel('Data inicial das métricas').fill('2026-10-01');await page.getByRole('button',{name:'Aplicar período'}).click();await expect(page.getByRole('alert')).toContainText('data inicial deve ser anterior');
});

test('administrator overview separates each client wallet instead of an aggregate balance',async({page})=>{
 const other='33333333-3333-4333-8333-333333333333';
 await mount(page,'admin',{profiles:[...profiles,{id:other,name:'Outro cliente',role:'client',active:true}],clients:[...fixture.clients,{id:other,email:'outro@example.com',phone:'',created_at:'2026-10-28T12:00:00Z'}],wallets:[{client_id:client,balance_cents:9000},{client_id:other,balance_cents:5000}]});
 await expect(page.locator('.client-wallet')).toHaveCount(2);
 await expect(page.locator('.client-wallet').filter({hasText:'Cliente de teste'}).locator('.individual-balance')).toHaveText('R$ 90,00');
 await expect(page.locator('.client-wallet').filter({hasText:'Outro cliente'}).locator('.individual-balance')).toHaveText('R$ 50,00');
 await expect(page.getByText('SALDO TOTAL DISPONÍVEL',{exact:true})).toHaveCount(0);
});

for(const width of [1440,390])test(`ranking podium, search, pagination and period filters ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});const calls:string[]=[];
 const rows=Array.from({length:26},(_,i)=>({id:String(i),name:i===0?'Ana Líder':`Cliente ${i+1}`,leads:100+i,sales:30-i,spend_cents:10000,campaigns:1,lead_events:['lead'],sale_events:['omni_purchase']}));
 await page.route('**/api/ranking*',r=>{calls.push(r.request().url());return r.fulfill({json:{rows,queried_at:new Date().toISOString()}})});
 await mount(page,'admin');if(width===390)await page.getByRole('button',{name:'Abrir menu'}).click();await page.getByRole('button',{name:'Ranking de vendas',exact:true}).click();
 await expect(page.locator('.ranking-panel h2')).toHaveText('Ranking de vendas');await expect(page.locator('.ranking-podium .podium-card')).toHaveCount(3);await expect(page.locator('.place-1')).toContainText('Ana Líder');await expect(page.locator('.ranking-panel tbody tr')).toHaveCount(25);
 await page.getByRole('button',{name:'Próxima página do ranking'}).click();await expect(page.locator('.ranking-panel tbody tr')).toHaveCount(1);
 await page.getByLabel('Pesquisar cliente no ranking').fill('ana lider');await expect(page.locator('.ranking-panel tbody tr')).toHaveCount(1);await expect(page.locator('.ranking-panel tbody tr')).toContainText('Ana Líder');
 for(const name of ['Ontem','Esta semana','7 dias','14 dias','15 dias','30 dias','90 dias','Este mês','Todos (até 36 meses)']){await page.getByRole('button',{name,exact:true}).click();await expect(page.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('.place-1')).toBeVisible();}
 await page.getByLabel('Data inicial do ranking').fill('2026-09-01');await page.getByLabel('Data final do ranking').fill('2026-09-30');await page.getByRole('button',{name:'Aplicar período'}).click();await expect(page.locator('.place-1')).toBeVisible();expect(calls.some(url=>url.includes('since=2026-09-01')&&url.includes('until=2026-09-30'))).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/tmp/techview-ranking-${width}.png`,fullPage:true});
});
test('ranking failures never display fabricated zeros or stale podium; clients have no global ranking tab',async({page})=>{
 await page.route('**/api/ranking*',r=>r.fulfill({status:400,json:{error:'Token da Meta indisponível'}}));await mount(page,'admin');await page.getByRole('button',{name:'Ranking de vendas',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Token da Meta indisponível');await expect(page.locator('.ranking-totals')).toHaveCount(0);await expect(page.locator('.ranking-podium')).toHaveCount(0);
 await mount(page,'client');await expect(page.getByRole('button',{name:'Ranking de vendas',exact:true})).toHaveCount(0);
});
for(const width of [1440,390])test(`individual debt is negative in overview, client detail, list and client login ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});
 const campaign={id:'123',account_id:'456',client_id:client,name:'Campanha teste',started_on:'2026-10-28',bound_at:'2026-10-28T12:00:00Z',baseline_cents:0,observed_cents:1962,charged_cents:0,baseline_impressions:0,baseline_clicks:0,impressions:100,clicks:2,sampled_at:new Date().toISOString(),last_error:null};
 const extra={wallets:[{client_id:client,balance_cents:0}],campaigns:[campaign],metaAvailable:false};
 await mount(page,'admin',extra);
 await expect(page.locator('.individual-balance')).toHaveText('-R$ 21,97');await expect(page.locator('.individual-balance')).toHaveClass(/negative-balance/);await expect(page.getByText('Saldo devedor • recarga necessária')).toBeVisible();
 if(width===390)await page.getByRole('button',{name:'Abrir menu'}).click();await page.getByRole('button',{name:'Clientes',exact:true}).click();await expect(page.locator('tbody td strong.negative-balance')).toHaveText('-R$ 21,97');
 await page.getByRole('button',{name:'Gerenciar',exact:true}).click();await expect(page.locator('.balance-value')).toHaveText('-R$ 21,97');
 await mount(page,'client',extra);await expect(page.locator('.balance-value')).toHaveText('-R$ 21,97');await expect(page.getByText('Seu saldo está negativo:',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Recarregar via Pix'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
for(const width of [1440,390])test(`negative balance opens a prominent warning and generates Pix directly ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});let requestBody:Record<string,unknown>={};
 const payload=pixPayload({key:'pix@example.com',name:'TECHVIEW TESTE',city:'SAO PAULO',cents:2197,txid:'QUITAR2197'});
 await page.route('**/api/action',async r=>{requestBody=r.request().postDataJSON();await r.fulfill({json:{ok:true,request:{id:'66666666-6666-4666-8666-666666666666',client_id:client,amount_cents:2197,status:'awaiting',txid:'QUITAR2197',payload,receiver_name:'TECHVIEW TESTE',bank:'Nubank',created_at:new Date().toISOString(),qr:await QRCode.toDataURL(payload)}}})});
 await mount(page,'client',{wallets:[{client_id:client,balance_cents:0}],campaigns:[{id:'123',account_id:'456',client_id:client,name:'Campanha teste',baseline_cents:0,observed_cents:1962,charged_cents:0,baseline_impressions:0,baseline_clicks:0,impressions:100,clicks:2,bound_at:'2026-10-28T12:00:00Z',started_on:'2026-10-28',sampled_at:new Date().toISOString(),last_error:null}],metaAvailable:false});
 const dialog=page.getByRole('dialog',{name:'Saldo negativo',exact:true});await expect(dialog).toBeVisible();await expect(dialog.getByRole('heading',{name:'Sua carteira está negativa'})).toBeVisible();await expect(dialog.locator('.debt-amount')).toHaveText('-R$ 21,97');
 await page.getByRole('button',{name:'Fazer recarga via Pix',exact:true}).click();await expect(page.getByAltText('QR Code Pix com valor e recebedor')).toBeVisible();await expect(page.getByRole('heading',{name:'R$ 21,97'})).toBeVisible();expect(requestBody).toEqual({action:'pix',amount:'21.97',ensure_minimum:true});await expect(page.locator('.balance-value')).toHaveText('-R$ 21,97');
});
for(const width of [1440,390])test(`own profile saves only own fields, previews/uploads a photo and limits brand controls ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});let saved:Record<string,unknown>={};let uploaded=false;
 await page.route('**/api/profile',r=>{saved=r.request().postDataJSON();return r.fulfill({json:{ok:true}})});
 await page.route('**/api/profile/avatar',r=>{uploaded=r.request().method()==='POST';return r.fulfill({json:{ok:true}})});
 await mount(page,'client');if(width===390)await page.getByRole('button',{name:'Abrir menu'}).click();await page.getByRole('button',{name:'Meu perfil',exact:true}).click();
 await page.getByLabel('Nome',{exact:true}).fill('Nome atualizado');await page.getByLabel('Telefone',{exact:true}).fill('11988887777');await expect(page.getByLabel('E-mail de acesso')).toHaveAttribute('readonly','');await page.getByRole('button',{name:'Salvar meu perfil'}).click();await expect(page.getByRole('status')).toContainText('Alterações salvas');expect(saved).toEqual({name:'Nome atualizado',phone:'11988887777'});
 await page.getByLabel('Escolher foto de perfil').setInputFiles({name:'foto.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64')});await expect(page.getByAltText('Prévia da sua foto')).toBeVisible();await page.getByRole('button',{name:'Enviar foto',exact:true}).click();expect(uploaded).toBe(true);await expect(page.getByLabel('Selecionar logo TechView')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('administrator can upload original brand art',async({page})=>{
 let uploaded=false;await page.route('**/api/brand/logo*',r=>r.request().method()==='POST'?(uploaded=true,r.fulfill({json:{ok:true}})):r.fulfill({status:404}));
 await mount(page,'admin');await page.getByRole('button',{name:'Meu perfil',exact:true}).click();await expect(page.getByRole('heading',{name:'Marca TechView'})).toBeVisible();await page.getByLabel('Selecionar logo TechView').setInputFiles({name:'logo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64')});await page.getByRole('button',{name:'Salvar logo TechView'}).click();await expect(page.getByRole('status')).toContainText('Alterações salvas');expect(uploaded).toBe(true);
});
