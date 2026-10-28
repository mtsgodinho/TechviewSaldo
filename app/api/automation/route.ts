import {NextResponse} from 'next/server';
import {actor} from '@/lib/supabase';
import {evolutionConfig} from '@/lib/evolution';
import {syncCampaigns} from '@/lib/meta';
import {z} from 'zod';
const headers={'Cache-Control':'private, no-store'};
export const maxDuration=60;
export async function GET(){let authorized=false;try{
 const {db,profile}=await actor();authorized=true;
 const {data:controls,error}=await db.from('balance_controls').select('client_id,balance_cents,alert_status,alert_message_id,alert_error,updated_at');if(error)throw new Error('Aplique o SQL único atualizado para habilitar os avisos e o limite de −R$ 20,00.');
 const {data:clients,error:clientError}=await db.from('clients').select('id,phone,whatsapp_opt_in');if(clientError)throw new Error('Não foi possível consultar os telefones');
 const {data:campaigns,error:campaignError}=await db.from('meta_campaigns').select('id,client_id,name,auto_pause_confirmed_at,auto_pause_checked_at,auto_pause_error');if(campaignError)throw new Error('Não foi possível consultar as pausas');
 return NextResponse.json({controls,clients,campaigns,whatsapp_configured:Boolean(evolutionConfig()),pause_limit_cents:-2000,admin:profile.role==='admin'},{headers});
 }catch(e){return NextResponse.json({error:(e as Error).message},{status:authorized?400:403,headers});}}
export async function POST(req:Request){try{
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Origem inválida'},{status:403,headers});
 const body=await req.json(),action=z.enum(['opt_in','sync']).parse(body.action);const {db,user,profile}=await actor(action==='sync');
 if(action==='sync')return NextResponse.json({ok:true,...await syncCampaigns(undefined,true)},{headers});
 const id=profile.role==='admin'?z.uuid().parse(body.client_id):user.id;const {error}=await db.rpc('set_whatsapp_opt_in',{p_client:id,p_enabled:z.boolean().parse(body.enabled)});if(error)throw new Error('Não foi possível atualizar a autorização de WhatsApp');return NextResponse.json({ok:true},{headers});
 }catch(e){return NextResponse.json({error:(e as Error).message},{status:400,headers});}}
