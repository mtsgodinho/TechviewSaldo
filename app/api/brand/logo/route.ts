import {NextResponse} from 'next/server';
import {configured,service} from '@/lib/supabase';
import {MEDIA_BUCKET} from '@/lib/media';
import {uploadMedia} from '@/lib/media-route';
export async function POST(req:Request){return uploadMedia(req,'logo');}
export async function GET(){try{
 if(!configured())return new NextResponse(null,{status:404});
 const svc=service(3000);const {data:brand,error}=await svc.from('brand_settings').select('logo_path').eq('id',true).maybeSingle();if(error||!brand?.logo_path)return new NextResponse(null,{status:404});
 const {data,error:e}=await svc.storage.from(MEDIA_BUCKET).download(brand.logo_path);if(e||!data)return new NextResponse(null,{status:404});
 return new NextResponse(data,{headers:{'Content-Type':'image/webp','Cache-Control':'public, max-age=0, must-revalidate','X-Content-Type-Options':'nosniff'}});
 }catch{return new NextResponse(null,{status:404});}}
