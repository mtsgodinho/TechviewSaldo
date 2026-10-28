import {test,expect} from '@playwright/test';
import sharp from 'sharp';
for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
 test(`login and configuration state ${viewport.width}px`,async({page})=>{
 await page.route('**/api/brand/logo*',r=>r.fulfill({status:404}));await page.setViewportSize(viewport);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByRole('heading',{name:'Acesse sua conta'})).toBeVisible();if(await page.getByText('Ambiente em configuração.',{exact:false}).count())await expect(page.getByRole('button',{name:'Entrar na plataforma'})).toBeDisabled();else await expect(page.getByRole('button',{name:'Entrar na plataforma'})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/techview-login-${viewport.width}.png`,fullPage:true});expect(errors).toEqual([]);
 });
}
test('API rejects untrusted origins',async({request})=>{const r=await request.post('/api/action',{headers:{origin:'https://untrusted.example'},data:{action:'confirm',id:'test'}});expect(r.status()).toBe(403);expect((await r.json()).error).toBe('Origem inválida');});

test('cron rejects missing credentials',async({request})=>{const r=await request.get('/api/cron/meta');expect(r.status()).toBe(401)});

test('global ranking API rejects unauthenticated access',async({request})=>{const r=await request.get('/api/ranking?since=2026-10-01&until=2026-10-28');expect(r.status()).toBe(403)});
test('login highlights uploaded logo and respects reduced motion',async({page})=>{
 const logo=await sharp({create:{width:900,height:600,channels:3,background:'#008cff'}}).png().toBuffer();await page.emulateMedia({reducedMotion:'reduce'});await page.route('**/api/brand/logo*',r=>r.fulfill({contentType:'image/png',body:logo}));
 await page.goto('/');await expect(page.locator('.brand-hero img')).toBeVisible();await expect(page.locator('.technology-background')).toBeAttached();expect(await page.locator('.tech-grid').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
});
test('profile and logo upload mutations reject foreign origins',async({request})=>{
 for(const path of ['/api/profile','/api/profile/avatar','/api/brand/logo']){const r=await request.post(path,{headers:{origin:'https://untrusted.example'},data:{name:'Forbidden'}});expect(r.status()).toBe(403);}
});
test('monthly API protects administrative changes and foreign origins',async({request})=>{
 const get=await request.get('/api/monthly');expect(get.status()).toBe(403);const post=await request.post('/api/monthly',{headers:{origin:'https://untrusted.example'},data:{action:'confirm',id:'test'}});expect(post.status()).toBe(403);
});

// next start usa --hostname 0.0.0.0; esta é a origem de req.url no servidor local.
test('archiving clients rejects an unauthenticated caller',async({request,baseURL})=>{const r=await request.post('/api/action',{headers:{origin:`http://0.0.0.0:${new URL(baseURL!).port}`},data:{action:'archiveClient',id:'22222222-2222-4222-8222-222222222222'}});expect(r.status()).toBe(400);expect((await r.json()).error).toBe('Sessão expirada')});

test('receipt API requires an authenticated session and never caches private responses',async({request})=>{const r=await request.get('/api/receipts/66666666-6666-4666-8666-666666666666');expect(r.status()).toBe(403);expect(r.headers()['cache-control']).toContain('no-store');expect((await r.json()).error).toContain('Entre na sua conta')});

test('Polygon API rejects anonymous access and foreign-origin mutations',async({request})=>{const get=await request.get('/api/polygon');expect(get.status()).toBe(403);expect(get.headers()['cache-control']).toContain('no-store');const post=await request.post('/api/polygon',{headers:{origin:'https://untrusted.example'},data:{action:'confirm',id:'test'}});expect(post.status()).toBe(403);expect((await post.json()).error).toBe('Origem inválida')});

test('automatic dollar rate API requires authentication and disables caching',async({request})=>{const r=await request.get('/api/polygon/rate');expect(r.status()).toBe(403);expect(r.headers()['cache-control']).toContain('no-store')});

test('automation API protects client debt and mutations',async({request})=>{const r=await request.get('/api/automation');expect(r.status()).toBe(403);expect(r.headers()['cache-control']).toContain('no-store');const post=await request.post('/api/automation',{headers:{origin:'https://untrusted.example'},data:{action:'sync'}});expect(post.status()).toBe(403)});
