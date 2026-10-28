import 'server-only';
import {service} from '@/lib/supabase';
import {metaCents,counter,accountDate} from '@/lib/meta-values';
import type {MetaCampaign} from '@/lib/types';
const VERSION='v24.0';
export function metaAccount(){const id=process.env.META_AD_ACCOUNT_ID?.replace(/^act_/,'').trim();if(!id||!/^\d+$/.test(id))throw new Error('Configure META_AD_ACCOUNT_ID no servidor');return id;}
export async function metaGet<T>(path:string,params:Record<string,string>={}):Promise<T>{
 const token=process.env.META_ACCESS_TOKEN;if(!token)throw new Error('Configure META_ACCESS_TOKEN no servidor');
 if(!/^[a-zA-Z0-9_/]+$/.test(path))throw new Error('Caminho Meta inválido');
 const url=new URL(`https://graph.facebook.com/${VERSION}/${path}`);for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
 const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(20000)});
 const body=await r.json();if(!r.ok||body.error){const code=body.error?.code;throw new Error(code===190?'O token da Meta expirou ou foi revogado. Renove o token no servidor.':`A Meta recusou a consulta (código ${Number(code)||r.status}). Verifique a permissão ads_read e o acesso à conta.`);}
 return body as T;
}
export async function remoteCampaigns(){
 const account=metaAccount();await verifyAccount();
 const rows:{id:string;name:string;effective_status:string}[]=[];let after:string|undefined;
 for(let page=0;page<100;page++){
  const r=await metaGet<{data:typeof rows;paging?:{cursors?:{after?:string};next?:string}}>(`act_${account}/campaigns`,{fields:'id,name,effective_status',limit:'100',...(after?{after}:{})});rows.push(...r.data);
  if(!r.paging?.next)return rows;after=r.paging.cursors?.after;if(!after)break;
 }
 throw new Error('Lista de campanhas incompleta. Não foi possível concluir a paginação.');
}
export async function verifyAccount(){const a=await metaGet<{currency:string;timezone_name:string}>(`act_${metaAccount()}`,{fields:'currency,timezone_name'});if(a.currency!=='BRL'||a.timezone_name!=='America/Sao_Paulo')throw new Error('A integração requer conta em BRL no fuso America/Sao_Paulo');}
export async function snapshot(id:string,since:string){
 const today=accountDate();const response=await metaGet<{data:{spend?:string;impressions?:string;clicks?:string}[]}>(`${id}/insights`,{fields:'spend,impressions,clicks',time_range:JSON.stringify({since,until:today}),limit:'1'});
 const row=response.data[0];return {spend:metaCents(row?.spend||'0'),impressions:counter(row?.impressions),clicks:counter(row?.clicks),sampled:new Date().toISOString()};
}
async function requireBillingSchema(){const {error}=await service().from('meta_campaigns').select('charged_tax_cents').limit(0);if(error)throw new Error('Aplique a migração 003_meta_activation_day.sql para ativar o gasto do dia com taxa de 12%.');}
export async function bindCampaign(id:string,client:string,admin:string){
 await requireBillingSchema();await verifyAccount();const c=await metaGet<{id:string;name:string;account_id:string}>(id,{fields:'id,name,account_id'});
 if(c.account_id!==metaAccount())throw new Error('Campanha não pertence à conta configurada');
 const date=accountDate(),s=await snapshot(id,date);const {error}=await service().rpc('bind_meta_campaign',{p_id:c.id,p_account:metaAccount(),p_client:client,p_name:c.name,p_date:date,p_spend:s.spend,p_impressions:s.impressions,p_clicks:s.clicks,p_sampled:s.sampled,p_admin:admin});
 if(error)throw new Error(error.code==='23505'?'Campanha já vinculada. Uma campanha só pode pertencer a um cliente.':error.message);
}
export async function syncCampaigns(client?:string,force=false){
 await requireBillingSchema();const db=service();let query=db.from('meta_campaigns').select('*').order('id');if(client)query=query.eq('client_id',client);
 const {data,error}=await query;if(error)throw new Error('Aplique a migração 002_meta.sql no Supabase antes de sincronizar');
 const campaigns=(data||[]) as MetaCampaign[];let updated=0,failed=0,debited=0;const errors:string[]=[];
 if(!campaigns.length)return {updated,failed,debited,errors};try{await verifyAccount();}catch(e){const message=e instanceof Error?e.message:'Falha no acesso à Meta';await db.from('meta_campaigns').update({last_error:message}).in('id',campaigns.map(c=>c.id));throw e;}
 for(const c of campaigns){
  if(!force&&Date.now()-new Date(c.sampled_at).getTime()<5*60*1000)continue;
  try{
   if(c.account_id!==metaAccount())throw new Error('A campanha usa outra conta. Não altere a conta vinculada no servidor.');
   const s=await snapshot(c.id,c.started_on);const {data:amount,error:e}=await db.rpc('apply_meta_snapshot',{p_id:c.id,p_spend:s.spend,p_impressions:s.impressions,p_clicks:s.clicks,p_sampled:s.sampled});if(e)throw new Error('Não foi possível registrar a sincronização no banco');updated++;debited+=Number(amount||0);
  }catch(e){failed++;const message=e instanceof Error?e.message:'Falha ao sincronizar';errors.push(message);await db.from('meta_campaigns').update({last_error:message}).eq('id',c.id);}
 }
 return {updated,failed,debited,errors:[...new Set(errors)]};
}
