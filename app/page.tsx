import {configured,supabase} from '@/lib/supabase';
import Dashboard from '@/components/dashboard';
import Login from '@/components/login';
export const dynamic='force-dynamic';
export default async function Page(){
 if(!configured()) return <Login configured={false}/>;
 const db=await supabase();const {data:{user}}=await db.auth.getUser();if(!user)return <Login configured/>;
 const {data:profile,error}=await db.from('profiles').select('*').eq('id',user.id).single();
 if(error||!profile?.active)return <Login configured error="Seu acesso está inativo ou ainda não foi cadastrado. Fale com o administrador."/>;
 // Percorre páginas para que o limite padrão da API não corte os totais/histórico.
 async function allRows(table:string,order:string){
  const first=await db.from(table).select('*').order(order,{ascending:false}).range(0,499);
  if(first.error)return first;
  const rows=first.data||[];
  for(let offset=500;rows.length===offset;offset+=500){const next=await db.from(table).select('*').order(order,{ascending:false}).range(offset,offset+499);if(next.error)return {...next,data:null};rows.push(...(next.data||[]));if((next.data?.length||0)<500)break;}
  return {...first,data:rows};
 }
 const results=await Promise.all([allRows('profiles','id'),allRows('clients','id'),allRows('wallets','client_id'),allRows('wallet_transactions','created_at'),allRows('pix_requests','created_at'),profile.role==='admin'?db.from('pix_settings').select('*').maybeSingle():Promise.resolve({data:null,error:null})]);
 const failed=results.find(r=>r.error);if(failed)return <Login configured error="Não foi possível carregar os dados. Verifique a conexão e a instalação do SQL no Supabase."/>;
 return <Dashboard data={{profile,profiles:results[0].data||[],clients:results[1].data||[],wallets:results[2].data||[],transactions:results[3].data||[],requests:results[4].data||[],settings:results[5].data}}/>;
}
