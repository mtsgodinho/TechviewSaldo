import {counter,metaCents} from './meta-values';
import type {Period} from './meta-period';
export type MetaAction={action_type:string;value:string};
export type RankedClient={id:string;name:string;leads:number;sales:number;spend_cents:number;campaigns:number;lead_events:string[];sale_events:string[]};
export type RankingOrder='sales'|'leads'|'conversion';
// Uma única família de eventos por métrica. Agregados e subtipos podem se sobrepor.
export function attributedEvents(actions:MetaAction[]=[]){
 const choose=(types:string[])=>{for(const type of types){const action=actions.find(a=>a.action_type===type);if(action){if(!/^\d+(\.\d+)?$/.test(action.value)||!Number.isFinite(Number(action.value))||Number(action.value)>Number.MAX_SAFE_INTEGER)throw new Error('Contagem de eventos da Meta inválida');return {count:Number(action.value),event:type};}}return {count:0,event:null};};
 return {leads:choose(['lead','omni_lead','offsite_conversion.fb_pixel_lead','onsite_conversion.lead_grouped']),sales:choose(['omni_purchase','purchase','offsite_conversion.fb_pixel_purchase','onsite_conversion.purchase'])};
}
export function conversion(row:Pick<RankedClient,'sales'|'leads'>){return row.leads>0?row.sales/row.leads*100:null;}
export function orderRanking(rows:RankedClient[],order:RankingOrder='sales'){
 return [...rows].sort((a,b)=>{
  const av=order==='conversion'?(conversion(a)??-1):a[order],bv=order==='conversion'?(conversion(b)??-1):b[order];
  return bv-av||b.sales-a.sales||b.leads-a.leads||a.name.localeCompare(b.name,'pt-BR')||a.id.localeCompare(b.id);
 });
}
export async function readRanking(clients:{id:string;name:string}[],campaigns:{id:string;account_id:string;client_id:string}[],account:string,period:Period,query:(id:string,period:Period)=>Promise<{data:{spend?:string;impressions?:string;actions?:MetaAction[]}[]}>){
 const clientsById=new Map(clients.map(c=>[c.id,{...c,leads:0,sales:0,spend_cents:0,campaigns:0,lead_events:[] as string[],sale_events:[] as string[]}]));
 if(campaigns.some(c=>c.account_id!==account||!/^\d+$/.test(c.id)||!clientsById.has(c.client_id)))throw new Error('Vínculos de campanha inconsistentes');
 const unique=new Set(campaigns.map(c=>c.id));if(unique.size!==campaigns.length)throw new Error('Campanha duplicada no ranking');
 for(let offset=0;offset<campaigns.length;offset+=4){
  const batch=await Promise.all(campaigns.slice(offset,offset+4).map(async c=>({campaign:c,response:await query(c.id,period)})));
  for(const {campaign,response} of batch){const row=response.data[0];const events=attributedEvents(row?.actions);const client=clientsById.get(campaign.client_id)!;
   // Valida também a forma básica do relatório, mesmo em campanhas sem eventos.
   counter(row?.impressions);client.campaigns++;client.spend_cents+=metaCents(row?.spend||'0');client.leads+=events.leads.count;client.sales+=events.sales.count;
   if(events.leads.event&&!client.lead_events.includes(events.leads.event))client.lead_events.push(events.leads.event);
   if(events.sales.event&&!client.sale_events.includes(events.sales.event))client.sale_events.push(events.sales.event);
  }
 }
 return orderRanking([...clientsById.values()]);
}
