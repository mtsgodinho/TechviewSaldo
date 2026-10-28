import 'server-only';
import {createServerClient} from '@supabase/ssr';
import {createClient} from '@supabase/supabase-js';
import {cookies} from 'next/headers';
export const configured=()=>Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export async function supabase(){
 const jar=await cookies();
 if(!configured()) throw new Error('Configure o Supabase nas variáveis de ambiente.');
 return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{cookies:{getAll:()=>jar.getAll(),setAll(items){try{items.forEach(({name,value,options})=>jar.set(name,value,options));}catch{}}}});
}
export function service(){if(!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('A chave administrativa do Supabase não foi configurada'); return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});}
export async function actor(admin=false){const db=await supabase();const {data:{user}}=await db.auth.getUser();if(!user) throw new Error('Sessão expirada');const {data:profile}=await db.from('profiles').select('*').eq('id',user.id).single();if(!profile?.active||(admin&&profile.role!=='admin')) throw new Error('Acesso não autorizado');return {db,user,profile};}
