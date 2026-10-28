import {NextResponse} from 'next/server';
import {actor,service,supabase} from '@/lib/supabase';
import {parseCents,pixPayload,rechargeCents} from '@/lib/pix';
import QRCode from 'qrcode';
import {z} from 'zod';
import type {PixRequest} from '@/lib/types';
export async function POST(req:Request){
 try{
 if(req.headers.get('origin')!==new URL(req.url).origin) return NextResponse.json({error:'Origem inválida'},{status:403});
 const b=await req.json();const action=z.string().parse(b.action);
 if(action==='login'){const db=await supabase();const {error}=await db.auth.signInWithPassword({email:z.email().parse(b.email),password:z.string().min(1).max(200).parse(b.password)});if(error)throw new Error('E-mail ou senha inválidos');return NextResponse.json({ok:true});}
 const admin=['settings','createClient','editClient','resetPassword','adjust','confirm','reject'].includes(action);
 const {db,user}=await actor(admin);
 if(action==='logout'){await db.auth.signOut();return NextResponse.json({ok:true});}
 if(action==='pix'){
 const requestedCents=parseCents(b.amount);const {data:settings,error}=await service().from('pix_settings').select('*').eq('id',true).single();if(error||!settings)throw new Error('O administrador ainda não configurou o Pix');const cents=rechargeCents(requestedCents,Number(settings.minimum_cents),b.ensure_minimum===true);if(cents<settings.minimum_cents)throw new Error(`Valor mínimo: R$ ${(settings.minimum_cents/100).toFixed(2)}`);
 const txid=crypto.randomUUID().replaceAll('-','').slice(0,25);const payload=pixPayload({key:settings.pix_key,name:settings.receiver_name,city:settings.city,cents,txid});
 const {data,error:e}=await service().rpc('create_pix_request',{p_client:user.id,p_cents:cents,p_txid:txid,p_payload:payload,p_receiver:settings.receiver_name,p_bank:settings.bank,p_settings_version:settings.updated_at}).single<PixRequest>();if(e)throw e;
 return NextResponse.json({ok:true,request:{...data,qr:await QRCode.toDataURL(payload,{errorCorrectionLevel:'M',margin:2,width:320})}});
 }
 if(action==='inform'){const {error}=await db.rpc('inform_payment',{p_id:z.uuid().parse(b.id)});if(error)throw error;}
 else if(action==='confirm'||action==='reject'){const {error}=await db.rpc('review_payment',{p_id:z.uuid().parse(b.id),p_confirm:action==='confirm'});if(error)throw error;}
 else if(action==='adjust'){const {error}=await db.rpc('adjust_wallet',{p_client:z.uuid().parse(b.client_id),p_cents:parseCents(b.amount),p_type:z.enum(['manual_credit','manual_debit','meta_ads','refund']).parse(b.type),p_reason:z.string().min(3).max(500).parse(b.reason),p_date:z.iso.date().parse(b.date),p_operation:z.uuid().parse(b.operation)});if(error)throw error;}
 else if(action==='settings'){const {error}=await db.rpc('save_pix_settings',{p_key:z.string().trim().min(3).max(77).parse(b.pix_key),p_name:z.string().trim().min(2).max(25).parse(b.receiver_name),p_city:z.string().trim().min(2).max(15).parse(b.city),p_bank:z.enum(['Nubank','Next','Outro']).parse(b.bank),p_minimum:parseCents(b.minimum)});if(error)throw error;}
 else if(action==='createClient'){
 const email=z.email().parse(b.email),name=z.string().trim().min(2).max(100).parse(b.name),phone=z.string().max(30).parse(b.phone||''),password=z.string().min(12).max(128).parse(b.password);
 const svc=service();const {data,error}=await svc.auth.admin.createUser({email,password,email_confirm:true});if(error)throw error;
 const {error:e}=await db.rpc('register_client',{p_id:data.user.id,p_name:name,p_email:email,p_phone:phone});if(e){await svc.auth.admin.deleteUser(data.user.id);throw e;}
 }
 else if(action==='editClient'){const {error}=await db.rpc('edit_client',{p_id:z.uuid().parse(b.id),p_name:z.string().min(2).max(100).parse(b.name),p_phone:z.string().max(30).parse(b.phone),p_active:z.boolean().parse(b.active)});if(error)throw error;}
 else if(action==='resetPassword'){const id=z.uuid().parse(b.id);const {data:c}=await db.from('clients').select('id').eq('id',id).single();if(!c)throw new Error('Cliente não encontrado');const {error}=await service().auth.admin.updateUserById(id,{password:z.string().min(12).max(128).parse(b.password)});if(error)throw error;await db.rpc('log_access_reset',{p_id:id});}
 else if(action!=='inform'&&action!=='logout')throw new Error('Operação inválida');
 return NextResponse.json({ok:true,user:user.id});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:((e as {message?:string})?.message||'Não foi possível concluir a operação')},{status:400});}
}
