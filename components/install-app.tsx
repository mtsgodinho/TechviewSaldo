'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Download,Smartphone,X} from 'lucide-react';
type InstallPrompt=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
export default function InstallApp({variant='login'}:{variant?:'login'|'menu'}){
 const [prompt,setPrompt]=useState<InstallPrompt|null>(null),[installed,setInstalled]=useState(false),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const dialog=useRef<HTMLElement>(null),button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  const mode=window.matchMedia('(display-mode: standalone)');
  const detect=()=>setInstalled(mode.matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone));detect();
  const capture=(e:Event)=>{e.preventDefault();setPrompt(e as InstallPrompt);};
  const done=()=>{setInstalled(true);setPrompt(null);setOpen(false);};
  window.addEventListener('beforeinstallprompt',capture);window.addEventListener('appinstalled',done);mode.addEventListener('change',detect);
  return ()=>{window.removeEventListener('beforeinstallprompt',capture);window.removeEventListener('appinstalled',done);mode.removeEventListener('change',detect);};
 },[]);
 useEffect(()=>{
  if(!open)return;const previous=document.activeElement as HTMLElement|null;dialog.current?.focus();
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);if(e.key==='Tab'){
   const focusable=dialog.current?.querySelectorAll<HTMLElement>('button,a[href],input,textarea');if(!focusable?.length)return;
   const first=focusable[0],last=focusable[focusable.length-1];
   if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last.focus();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){e.preventDefault();first.focus();}
  }};document.addEventListener('keydown',key);return ()=>{document.removeEventListener('keydown',key);previous?.focus();};
 },[open]);
 async function install(){
  if(!prompt){setOpen(true);return;}setBusy(true);setMessage('');
  try{await prompt.prompt();const choice=await prompt.userChoice;setPrompt(null);if(choice.outcome==='dismissed'){setMessage('A instalação foi cancelada. Você pode tentar novamente pelo menu do navegador.');setOpen(true);}}
  catch{setPrompt(null);setOpen(true);setMessage('O navegador não abriu a instalação. Siga as instruções abaixo.');}finally{setBusy(false);}
 }
 if(installed)return null;
 return <><button ref={button} type="button" className={variant==='menu'?'nav-link install-menu':'secondary install-login'} onClick={install} disabled={busy}><Download size={18}/>{busy?'Abrindo instalação…':'Instalar no celular'}</button>
 {open&&createPortal(<div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}><section ref={dialog} className="modal install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title" tabIndex={-1}>
 <button className="close" aria-label="Fechar instalação" onClick={()=>setOpen(false)}><X/></button><span className="icon-box"><Smartphone/></span><h2 id="install-title">TechView na tela inicial</h2><p>Abra o painel por um ícone no seu celular.</p>{message&&<div className="notice" role="status">{message}</div>}
 <h3>Android · Google Chrome</h3><ol><li>Abra este endereço no aplicativo Google Chrome.</li><li>Toque no menu ⋮ e procure <strong>Adicionar à tela inicial</strong> ou <strong>Instalar aplicativo</strong>.</li><li>Confirme a instalação ou a criação do atalho.</li></ol>
 <h3>iPhone · Safari</h3><ol><li>Abra este endereço no Safari.</li><li>Toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.</li></ol>
 <label>Endereço do painel<input readOnly value="https://techview-saldo.vercel.app" onFocus={e=>e.currentTarget.select()}/></label>
 <small>Se a opção não aparecer no navegador atual, use Chrome no Android ou Safari no iPhone. O acesso precisa de internet e mantém o login individual.</small>
 {prompt&&<button className="primary full" onClick={install} disabled={busy}>Instalar aplicativo</button>}
 </section></div>,document.body)}</>;
}
