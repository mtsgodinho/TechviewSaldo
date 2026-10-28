import {NextResponse} from 'next/server';
import {actor} from '@/lib/supabase';
import {remoteCampaigns,bindCampaign,syncCampaigns} from '@/lib/meta';
import {z} from 'zod';
export const maxDuration=60;
export async function GET(){try{await actor(true);return NextResponse.json({campaigns:await remoteCampaigns()},{headers:{'Cache-Control':'no-store'}});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Falha ao consultar campanhas'},{status:400});}}
export async function POST(req:Request){try{
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Origem inválida'},{status:403});
 const body=await req.json();const action=z.enum(['bind','sync']).parse(body.action);const {user,profile}=await actor(action==='bind');
 if(action==='bind'){await bindCampaign(z.string().regex(/^\d+$/).parse(body.campaign_id),z.uuid().parse(body.client_id),user.id);return NextResponse.json({ok:true});}
 const result=await syncCampaigns(profile.role==='admin'?undefined:user.id,profile.role==='admin'&&body.force===true);return NextResponse.json({ok:result.failed===0,...result});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Falha ao sincronizar Meta Ads'},{status:400});}}
