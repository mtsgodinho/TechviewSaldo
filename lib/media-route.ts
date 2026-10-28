import 'server-only';
import {NextResponse} from 'next/server';
import {actor,service} from '@/lib/supabase';
import {normalizeImage,MEDIA_BUCKET,MAX_MEDIA_BYTES} from '@/lib/media';
export async function uploadMedia(req:Request,kind:'avatar'|'logo'){
 try{
  if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Origem inválida'},{status:403});
  const {db,user}=await actor(kind==='logo');
  if(Number(req.headers.get('content-length')||0)>MAX_MEDIA_BYTES+65536)throw new Error('Envie uma imagem de até 4 MB');
  const form=await req.formData(),file=form.get('file');if(!(file instanceof File)||file.size>MAX_MEDIA_BYTES)throw new Error('Envie uma imagem de até 4 MB');
  const image=await normalizeImage(new Uint8Array(await file.arrayBuffer()),kind);
  const path=`${kind==='logo'?'brand':user.id}/${crypto.randomUUID()}.webp`,svc=service();
  const {error:uploadError}=await svc.storage.from(MEDIA_BUCKET).upload(path,image,{contentType:'image/webp',upsert:false});if(uploadError)throw new Error('Não foi possível enviar a imagem. Aplique a atualização de perfil no Supabase.');
  const {data:old,error}=await db.rpc(kind==='logo'?'set_brand_logo':'set_own_avatar',{p_path:path});
  if(error){await svc.storage.from(MEDIA_BUCKET).remove([path]);throw new Error('Não foi possível salvar a imagem no perfil');}
  // Arquivos antigos só são removidos depois de a nova referência ser confirmada.
  if(typeof old==='string'&&old.startsWith(kind==='logo'?'brand/':user.id+'/'))await svc.storage.from(MEDIA_BUCKET).remove([old]);
  return NextResponse.json({ok:true});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Falha ao enviar imagem'},{status:400});}
}
