import {money} from '@/lib/types';
export function whatsappNumber(value:string){
 if(typeof value!=='string'||(/[^\d+\s().-]/.test(value)||value.trim().slice(1).includes('+')))throw new Error('Telefone do cliente inválido');
 let digits=value.replace(/\D/g,'');if(!value.trim().startsWith('+')&&(digits.length===10||digits.length===11))digits='55'+digits;
 if(!/^[1-9]\d{9,14}$/.test(digits))throw new Error('Cadastre o telefone com DDD ou código internacional');return digits;
}
export type EvolutionConfig={url:string;instance:string;key:string};
export function evolutionConfig(env:Record<string,string|undefined>=process.env):EvolutionConfig|null{
 if(!env.EVOLUTION_API_URL||!env.EVOLUTION_INSTANCE||!env.EVOLUTION_API_KEY)return null;
 try{const url=new URL(env.EVOLUTION_API_URL);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!/^[a-zA-Z0-9_-]{1,100}$/.test(env.EVOLUTION_INSTANCE))return null;return {url:url.toString().replace(/\/$/,''),instance:env.EVOLUTION_INSTANCE,key:env.EVOLUTION_API_KEY};}catch{return null;}
}
export function debtMessage(name:string,balance:number){
 if(!Number.isSafeInteger(balance)||balance>=0)throw new Error('Saldo devedor inválido');
 return `Olá, ${name.replace(/[\r\n]/g,' ').slice(0,100)}! Sua carteira TechView está com saldo negativo de ${money(Math.abs(balance))}, considerando anúncios e a taxa de 12%.\n\nFaça uma recarga em https://techview-saldo.vercel.app para regularizar seu saldo. O crédito é liberado após a confirmação do pagamento.\n\nAo atingir −R$ 20,00, as campanhas vinculadas entram na pausa automática durante a sincronização com a Meta. Se esse limite já foi atingido, confira a situação no painel. A recarga não reativa campanhas automaticamente.\n\nTechView — Convertemos cliques em vendas.`;
}
export type EvolutionResult={status:'sent'|'failed'|'unknown';messageId:string|null;error:string|null};
export async function sendDebtAlert(config:EvolutionConfig,phone:string,name:string,balance:number,fetcher:typeof fetch=fetch):Promise<EvolutionResult>{
 let number:string,text:string;try{number=whatsappNumber(phone);text=debtMessage(name,balance)}catch(e){return {status:'failed',messageId:null,error:(e as Error).message}}
 try{
  const response=await fetcher(`${config.url}/message/sendText/${encodeURIComponent(config.instance)}`,{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:JSON.stringify({number,text}),cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)return {status:response.status>=500?'unknown':'failed',messageId:null,error:`Evolution retornou HTTP ${response.status}. Verifique a conexão da instância e as credenciais.`};
  const result=await response.json();const id=result?.key?.id;
  if(typeof id!=='string'||!id.length)return {status:'unknown',messageId:null,error:'Evolution não informou o ID da mensagem. Confira a instância antes de reenviar.'};
  return {status:'sent',messageId:id,error:null};
 }catch{return {status:'unknown',messageId:null,error:'Sem resposta final da Evolution. Confira a instância antes de reenviar; o envio não será repetido automaticamente.'}}
}
