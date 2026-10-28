import {NextResponse} from 'next/server';
import {z} from 'zod';
import {actor,service} from '@/lib/supabase';
import {MEDIA_BUCKET} from '@/lib/media';
import {uploadMedia} from '@/lib/media-route';
export async function POST(req:Request){return uploadMedia(req,'avatar');}
export async function GET(req:Request){try{
 const {db,user}=await actor();const id=z.uuid().parse(new URL(req.url).searchParams.get('id')||user.id);
 const {data:profile,error}=await db.from('profiles').select('avatar_path').eq('id',id).maybeSingle();if(error||!profile?.avatar_path)return new NextResponse(null,{status:404});
 const {data,error:e}=await service().storage.from(MEDIA_BUCKET).download(profile.avatar_path);if(e||!data)return new NextResponse(null,{status:404});
 return new NextResponse(data,{headers:{'Content-Type':'image/webp','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch{return new NextResponse(null,{status:403});}}
export async function DELETE(req:Request){try{
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Origem inválida'},{status:403});
 const {db,user}=await actor();const {data:old,error}=await db.rpc('set_own_avatar',{p_path:null});if(error)throw new Error('Não foi possível remover sua foto');if(typeof old==='string'&&old.startsWith(user.id+'/'))await service().storage.from(MEDIA_BUCKET).remove([old]);return NextResponse.json({ok:true});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Falha ao remover foto'},{status:400});}}
