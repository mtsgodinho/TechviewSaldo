import {test,expect} from '@playwright/test';
for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
 test(`login and configuration state ${viewport.width}px`,async({page})=>{
 await page.setViewportSize(viewport);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByRole('heading',{name:'Acesse sua conta'})).toBeVisible();await expect(page.getByText('Ambiente em configuração.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Entrar na plataforma'})).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/techview-login-${viewport.width}.png`,fullPage:true});expect(errors).toEqual([]);
 });
}
test('API rejects untrusted origins',async({request})=>{const r=await request.post('/api/action',{headers:{origin:'https://untrusted.example'},data:{action:'confirm',id:'test'}});expect(r.status()).toBe(403);expect((await r.json()).error).toBe('Origem inválida');});
