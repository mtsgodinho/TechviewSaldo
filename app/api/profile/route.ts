import {NextResponse} from 'next/server';
import {actor} from '@/lib/supabase';
import {z} from 'zod';
export async function POST(req:Request){try{
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Origem inválida'},{status:403});
 const {db}=await actor();const data=z.object({name:z.string().trim().min(2).max(100),phone:z.string().trim().max(30)}).strict().parse(await req.json());
 const {error}=await db.rpc('update_own_profile',{p_name:data.name,p_phone:data.phone});if(error)throw new Error('Não foi possível salvar. Verifique se a atualização de perfil foi aplicada no Supabase.');return NextResponse.json({ok:true});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Falha ao atualizar perfil'},{status:400});}}
