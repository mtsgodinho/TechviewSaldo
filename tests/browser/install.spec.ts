import {test,expect} from '@playwright/test';
import sharp from 'sharp';
test.beforeEach(async({page})=>{await page.route('**/api/brand/logo*',r=>r.fulfill({status:404}));});
test('install manifest and public home screen icons are available without login',async({request})=>{
 const r=await request.get('/manifest.webmanifest');expect(r.ok()).toBe(true);const manifest=await r.json();expect(manifest.name).toBe('TechView Saldo');expect(manifest.start_url).toBe('/');expect(manifest.display).toBe('standalone');
 for(const size of [180,192,512]){const response=await request.get(`/icons/techview-${size}.png?v=1.2`);expect(response.ok()).toBe(true);expect(response.headers()['content-type']).toBe('image/png');const meta=await sharp(await response.body()).metadata();expect(meta.width).toBe(size);expect(meta.height).toBe(size);}

});
for(const width of [1440,390])test(`installation help is available without a browser install prompt ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await page.goto('/');await page.getByRole('button',{name:'Instalar no celular',exact:true}).click();const dialog=page.getByRole('dialog',{name:'TechView na tela inicial'});await expect(dialog).toBeVisible();await expect(dialog).toContainText('Google Chrome');await expect(dialog).toContainText('Safari');await expect(dialog.getByRole('textbox',{name:'Endereço do painel'})).toHaveValue('https://techview-saldo.vercel.app');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/tmp/techview-install-${width}.png`,fullPage:true});await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Instalar no celular',exact:true})).toBeFocused();
});
test('install button uses browser prompt and hides only after installation completes',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Instalar no celular'}).click();await page.getByRole('button',{name:'Fechar instalação'}).click();
 await page.evaluate(()=>{const e=new Event('beforeinstallprompt',{cancelable:true});Object.assign(e,{prompt:async()=>{document.documentElement.dataset.prompted='yes'},userChoice:Promise.resolve({outcome:'accepted'})});window.dispatchEvent(e)});
 await page.getByRole('button',{name:'Instalar no celular'}).click();await expect(page.locator('html')).toHaveAttribute('data-prompted','yes');await expect(page.getByRole('button',{name:'Instalar no celular'})).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));await expect(page.getByRole('button',{name:'Instalar no celular'})).toHaveCount(0);
});
test('declined installation keeps manual instructions accessible',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Instalar no celular'}).click();await page.getByRole('button',{name:'Fechar instalação'}).click();
 await page.evaluate(()=>{const e=new Event('beforeinstallprompt',{cancelable:true});Object.assign(e,{prompt:async()=>{},userChoice:Promise.resolve({outcome:'dismissed'})});window.dispatchEvent(e)});await page.getByRole('button',{name:'Instalar no celular'}).click();await expect(page.getByRole('dialog')).toContainText('A instalação foi cancelada');
});
