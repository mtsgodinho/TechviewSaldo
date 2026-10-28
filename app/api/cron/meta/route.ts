import {NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {syncCampaigns} from '@/lib/meta';
export const maxDuration=60;
export async function GET(req:Request){
 const expected=process.env.CRON_SECRET;const got=req.headers.get('authorization')||'';
 if(!expected||expected.length<32||Buffer.byteLength(got)!==Buffer.byteLength(`Bearer ${expected}`)||!timingSafeEqual(Buffer.from(got),Buffer.from(`Bearer ${expected}`)))return NextResponse.json({error:'Não autorizado'},{status:401});
 try{const result=await syncCampaigns();return NextResponse.json(result,{status:result.failed||result.automation?.errors.length?502:200,headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'Sincronização indisponível. Consulte a integração no painel administrativo.'},{status:502});}
}
