import {metaCents,counter} from './meta-values';
import type {CampaignReport,Period} from './meta-period';
import {attributedEvents,type MetaAction} from './meta-ranking';
type Insight={spend?:string;impressions?:string;clicks?:string;actions?:MetaAction[]};
// Dependência exclusiva de leitura. Não acessa carteiras, snapshots ou RPCs de débito.
export async function readCampaignReport(campaigns:{id:string;account_id:string}[],account:string,period:Period,query:(id:string,period:Period)=>Promise<{data:Insight[]}>):Promise<CampaignReport[]>{
 if(campaigns.some(c=>c.account_id!==account||!/^\d+$/.test(c.id)))throw new Error('Campanha vinculada a outra conta de anúncios');
 const result:CampaignReport[]=[];
 for(let offset=0;offset<campaigns.length;offset+=4){
  const batch=await Promise.all(campaigns.slice(offset,offset+4).map(async c=>{
   const response=await query(c.id,period);const row=response.data[0];
   const sales=attributedEvents(row?.actions).sales;
   return {id:c.id,spend_cents:metaCents(row?.spend||'0'),impressions:counter(row?.impressions),clicks:counter(row?.clicks),sales:sales.count,sale_event:sales.event};
  }));result.push(...batch);
 }
 return result;
}
