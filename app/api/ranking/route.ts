import {NextResponse} from 'next/server';
import {actor} from '@/lib/supabase';
import {metaGet,metaAccount} from '@/lib/meta';
import {validatePeriod} from '@/lib/meta-period';
import {readRanking} from '@/lib/meta-ranking';
export const maxDuration=60;
export async function GET(req:Request){
 let authorized=false;
 try{
  const {db}=await actor(true);authorized=true;
  const params=new URL(req.url).searchParams,period=validatePeriod(params.get('since')||'',params.get('until')||'');
  const clients:{id:string;name:string}[]=[];const campaigns:{id:string;account_id:string;client_id:string}[]=[];
  for(let offset=0;;offset+=500){const {data,error}=await db.from('profiles').select('id,name').eq('role','client').order('id').range(offset,offset+499);if(error)throw new Error('Não foi possível carregar os clientes');clients.push(...(data||[]));if((data?.length||0)<500)break;}
  for(let offset=0;;offset+=500){const {data,error}=await db.from('meta_campaigns').select('id,account_id,client_id').order('id').range(offset,offset+499);if(error)throw new Error('Não foi possível carregar as campanhas vinculadas');campaigns.push(...(data||[]));if((data?.length||0)<500)break;}
  const rows=await readRanking(clients,campaigns,metaAccount(),period,(id,range)=>metaGet(`${id}/insights`,{fields:'spend,impressions,actions',time_range:JSON.stringify(range),use_unified_attribution_setting:'true',action_report_time:'impression',limit:'1'}));
  return NextResponse.json({rows,period,queried_at:new Date().toISOString(),source:'Meta Ads: eventos atribuídos, conforme configuração de atribuição dos conjuntos de anúncios'},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Não foi possível consultar o ranking'},{status:authorized?400:403});}
}
