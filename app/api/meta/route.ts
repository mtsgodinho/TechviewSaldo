import {NextResponse} from 'next/server';
import {actor} from '@/lib/supabase';
import {remoteCampaigns,bindCampaign,syncCampaigns,metaAccount,metaGet} from '@/lib/meta';
import {z} from 'zod';
import {validatePeriod} from '@/lib/meta-period';
import {readCampaignReport} from '@/lib/meta-report';
export const maxDuration=60;
export async function GET(req:Request){try{
 const params=new URL(req.url).searchParams;
 if(params.get('action')==='insights'){
  const {db}=await actor();const period=validatePeriod(params.get('since')||'',params.get('until')||'');
  // A lista de IDs vem do banco sob RLS, nunca de parâmetros do navegador.
  const scope=params.get('client');if(scope)z.uuid().parse(scope);const campaign=params.get('campaign');if(campaign)z.string().regex(/^\d+$/).parse(campaign);
  const campaigns:{id:string;account_id:string}[]=[];
  for(let offset=0;;offset+=500){let query=db.from('meta_campaigns').select('id,account_id').order('id').range(offset,offset+499);if(scope)query=query.eq('client_id',scope);if(campaign)query=query.eq('id',campaign);const {data,error}=await query;if(error)throw new Error('Não foi possível consultar as campanhas vinculadas');campaigns.push(...(data||[]));if((data?.length||0)<500)break;}
  const rows=await readCampaignReport(campaigns,metaAccount(),period,(id,range)=>metaGet(`${id}/insights`,{fields:'spend,impressions,clicks,actions',time_range:JSON.stringify(range),use_unified_attribution_setting:'true',action_report_time:'impression',limit:'1'}));
  return NextResponse.json({period,rows,queried_at:new Date().toISOString()},{headers:{'Cache-Control':'private, no-store'}});
 }
 await actor(true);return NextResponse.json({campaigns:await remoteCampaigns()},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Falha ao consultar campanhas'},{status:400});}}
export async function POST(req:Request){try{
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Origem inválida'},{status:403});
 const body=await req.json();const action=z.enum(['bind','sync']).parse(body.action);const {user,profile}=await actor(action==='bind');
 if(action==='bind'){await bindCampaign(z.string().regex(/^\d+$/).parse(body.campaign_id),z.uuid().parse(body.client_id),user.id);return NextResponse.json({ok:true});}
 const result=await syncCampaigns(profile.role==='admin'?undefined:user.id,profile.role==='admin'&&body.force===true);return NextResponse.json({ok:result.failed===0,...result});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Falha ao sincronizar Meta Ads'},{status:400});}}
