import {NextResponse} from 'next/server';
import {actor,service} from '@/lib/supabase';
import {fetchPolygonRate} from '@/lib/polygon-rate';
import {parseCents} from '@/lib/pix';
import {polygonAddress,transactionHash,type PolygonRequest} from '@/lib/polygon';
import {z} from 'zod';
import QRCode from 'qrcode';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){let authorized=false;try{
 const {db}=await actor();authorized=true;
 const {data:settings,error}=await db.from('polygon_settings').select('*').eq('id',true).maybeSingle();if(error)throw new Error('Aplique o SQL único atualizado para habilitar USDT na Polygon');
 const requests=[];for(let offset=0;;offset+=500){const {data,error:e}=await db.from('polygon_requests').select('*').order('created_at',{ascending:false}).range(offset,offset+499);if(e)throw new Error('Não foi possível carregar as recargas USDT');requests.push(...(data||[]));if((data?.length||0)<500)break;}
 return NextResponse.json({settings,requests},{headers});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Não foi possível consultar USDT'},{status:authorized?400:403,headers});}}
export async function POST(req:Request){let authorized=false;try{
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Origem inválida'},{status:403,headers});
 const b=await req.json(),action=z.enum(['settings','create','inform','confirm','reject','cancel']).parse(b.action);const {db,user,profile}=await actor(['settings','confirm','reject'].includes(action));authorized=true;
 if(action==='settings'){
  const address=polygonAddress(z.string().parse(b.address));if(address!==polygonAddress(z.string().parse(b.confirm_address)))throw new Error('A confirmação do endereço não confere');
  const {error}=await db.rpc('configure_polygon_receiving',{p_address:address,p_minimum:parseCents(z.string().parse(b.minimum)),p_enabled:z.boolean().parse(b.enabled)});if(error)throw new Error(error.message);
 }else if(action==='create'){
  const client=profile.role==='admin'?z.uuid().parse(b.client_id):user.id;
  const cents=parseCents(z.string().parse(b.amount));
  const {data:pending,error:pendingError}=await db.from('polygon_requests').select('*').eq('client_id',client).in('status',['awaiting','informed']).maybeSingle<PolygonRequest>();if(pendingError)throw new Error('Não foi possível consultar a solicitação USDT');
  let request=pending;
  if(!request){
   const quote=await fetchPolygonRate();
   const {data,error}=await service(10000).rpc('create_polygon_request_at_rate',{p_actor:user.id,p_client:client,p_cents:cents,p_rate:quote.rate_micro_brl,p_quoted_at:quote.quoted_at,p_source:quote.source}).single<PolygonRequest>();if(error)throw new Error('Não foi possível gerar a recarga. Confira se o SQL único atualizado foi aplicado.');request=data;
  }
  return NextResponse.json({ok:true,request:{...request,qr:await QRCode.toDataURL(request.recipient_address,{width:320,margin:2})}},{headers});
 }else if(action==='inform'){
  const {error}=await db.rpc('inform_polygon_payment',{p_id:z.uuid().parse(b.id),p_hash:transactionHash(z.string().parse(b.hash))});if(error)throw new Error(error.message);
 }else if(action==='cancel'){
  const {error}=await db.rpc('cancel_polygon_request',{p_id:z.uuid().parse(b.id)});if(error)throw new Error(error.message);
 }else{
  const {error}=await db.rpc('review_polygon_payment',{p_id:z.uuid().parse(b.id),p_confirm:action==='confirm',p_expected_hash:action==='confirm'?transactionHash(z.string().parse(b.hash)):null});if(error)throw new Error(error.message);
 }
 return NextResponse.json({ok:true},{headers});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Não foi possível concluir a operação USDT'},{status:authorized?400:403,headers});}}
