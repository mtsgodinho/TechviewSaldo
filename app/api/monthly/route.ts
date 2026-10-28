import {NextResponse} from 'next/server';
import {actor,service} from '@/lib/supabase';
import {parseCents,pixPayload} from '@/lib/pix';
import QRCode from 'qrcode';
import type {MonthlyRequest} from '@/lib/monthly';
import {z} from 'zod';
export async function GET(){let authorized=false;try{
 const {db}=await actor();authorized=true;
 async function rows(table:string,order:string){const all=[];for(let offset=0;;offset+=500){const {data,error}=await db.from(table).select('*').order(order,{ascending:false}).range(offset,offset+499);if(error)throw new Error('Aplique o SQL de Mensalidade no Supabase para habilitar esta aba');all.push(...(data||[]));if((data?.length||0)<500)return all;}}
 const [settings,cycles,requests]=await Promise.all([rows('monthly_settings','client_id'),rows('monthly_cycles','starts_at'),rows('monthly_requests','created_at')]);
 return NextResponse.json({settings,cycles,requests,serverNow:new Date().toISOString()},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Não foi possível carregar a mensalidade'},{status:authorized?400:403});}}
export async function POST(req:Request){let authorized=false;try{
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Origem inválida'},{status:403});
 const b=await req.json();const action=z.enum(['set_amount','generate','inform','confirm','reject']).parse(b.action);
 const {db,user,profile}=await actor(['set_amount','confirm','reject'].includes(action));authorized=true;
 if(action==='set_amount'){const {error}=await db.rpc('set_monthly_amount',{p_client:z.uuid().parse(b.client_id),p_cents:parseCents(z.string().parse(b.amount))});if(error)throw new Error(error.message);}
 else if(action==='generate'){
  const client=profile.role==='admin'?z.uuid().parse(b.client_id):user.id,svc=service();
  const [{data:fee,error:fe},{data:settings,error:pe}]=await Promise.all([svc.from('monthly_settings').select('*').eq('client_id',client).single(),svc.from('pix_settings').select('*').eq('id',true).single()]);
  if(fe||!fee)throw new Error('O administrador precisa definir o valor mensal');if(pe||!settings)throw new Error('O administrador precisa configurar o Pix');
  const txid='M'+crypto.randomUUID().replaceAll('-','').slice(0,24),payload=pixPayload({key:settings.pix_key,name:settings.receiver_name,city:settings.city,cents:Number(fee.amount_cents),txid});
  const {data,error}=await svc.rpc('create_monthly_request',{p_client:client,p_actor:user.id,p_cents:fee.amount_cents,p_txid:txid,p_payload:payload,p_receiver:settings.receiver_name,p_bank:settings.bank,p_settings_version:settings.updated_at,p_fee_version:fee.updated_at}).single<MonthlyRequest>();
  if(error)throw new Error(error.message);return NextResponse.json({ok:true,request:{...data,qr:await QRCode.toDataURL(data.payload,{width:320,margin:2,errorCorrectionLevel:'M'})}});
 }
 else if(action==='inform'){const {error}=await db.rpc('inform_monthly_payment',{p_id:z.uuid().parse(b.id)});if(error)throw new Error(error.message);}
 else{const {error}=await db.rpc('review_monthly_payment',{p_id:z.uuid().parse(b.id),p_confirm:action==='confirm'});if(error)throw new Error(error.message);}
 return NextResponse.json({ok:true});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Não foi possível salvar a mensalidade'},{status:authorized?400:403});}}
