import 'server-only';
import {service} from '@/lib/supabase';
import type {MetaCampaign} from '@/lib/types';
import {evolutionConfig,sendDebtAlert} from '@/lib/evolution';
import {pauseCampaign,type PauseGateway} from '@/lib/meta-pause';
type Claim={client_id:string;balance_cents:number;negative_episode:string;processing_id:string;send_alert:boolean;needs_pause:boolean;name:string;phone:string};
export async function runBalanceControls(campaigns:MetaCampaign[],account:string,gateway:PauseGateway){
 const db=service(10000),result={enabled:true,paused:0,alerts_sent:0,errors:[] as string[]};
 const {error:schemaError}=await db.from('balance_controls').select('client_id').limit(0);if(schemaError)return {...result,enabled:false,errors:['Aplique o SQL único atualizado para ativar os avisos e a pausa em −R$ 20,00.']};
 const config=evolutionConfig();
 for(const client of [...new Set(campaigns.map(c=>c.client_id))]){
  const {data,error}=await db.rpc('claim_balance_control',{p_client:client,p_send_enabled:Boolean(config)});if(error){result.errors.push('Não foi possível consultar o limite da carteira');continue;}const claim=data as Claim|null;if(!claim)continue;
  try{
   // A pausa tem prioridade sobre o envio do aviso.
   if(claim.needs_pause)for(const campaign of campaigns.filter(c=>c.client_id===client)){
    try{
     if(campaign.account_id!==account)throw new Error('A campanha usa outra conta de anúncios');
     const confirmed=await pauseCampaign(campaign.id,account,gateway,async()=>{const current=await db.rpc('client_net_balance',{p_client:client});if(current.error)throw new Error('Não foi possível reconferir a carteira antes da pausa');return Number(current.data)<=-2000});
     if(confirmed){result.paused++;const {error:updateError}=await db.rpc('record_auto_pause',{p_campaign:campaign.id,p_confirmed:true,p_error:null});if(updateError)throw new Error('Pausa confirmada na Meta, mas não foi possível registrar no painel');}
    }catch(e){const message=e instanceof Error?e.message:'Falha na pausa automática';result.errors.push(`${campaign.name}: ${message}`);await db.rpc('record_auto_pause',{p_campaign:campaign.id,p_confirmed:false,p_error:message});}
   }
   if(claim.send_alert&&config){
    // Não envia o alerta se uma recarga já regularizou a carteira após a consulta inicial.
    const [current,control,recipient,profile]=await Promise.all([db.rpc('client_net_balance',{p_client:client}),db.from('balance_controls').select('processing_id,negative_episode').eq('client_id',client).single(),db.from('clients').select('phone,whatsapp_opt_in').eq('id',client).single(),db.from('profiles').select('active').eq('id',client).single()]);
    if(control.error||control.data?.processing_id!==claim.processing_id||control.data?.negative_episode!==claim.negative_episode)continue;
    const outcome=recipient.error||profile.error||!recipient.data?.whatsapp_opt_in||!profile.data?.active?{status:'failed' as const,messageId:null,error:'Envio não autorizado pelo cadastro atual'}:current.error||!Number.isSafeInteger(Number(current.data))?{status:'failed' as const,messageId:null,error:'Não foi possível reconferir o saldo antes do aviso'}:Number(current.data)>=0?{status:'failed' as const,messageId:null,error:'Saldo regularizado antes do envio'}:await sendDebtAlert(config,recipient.data.phone,claim.name,Number(current.data));
    const finished=await db.rpc('finish_balance_alert',{p_client:client,p_processing:claim.processing_id,p_episode:claim.negative_episode,p_status:outcome.status,p_message_id:outcome.messageId,p_error:outcome.error});if(finished.error)result.errors.push('Não foi possível registrar o resultado do WhatsApp; confira a Evolution antes de reenviar');else if(outcome.status==='sent')result.alerts_sent++;else result.errors.push(`${claim.name}: ${outcome.error}`);
   }
  }finally{await db.rpc('release_balance_control',{p_client:client,p_processing:claim.processing_id});}
 }
 return result;
}
