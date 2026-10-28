export type PauseGateway={get:(id:string)=>Promise<{id:string;account_id:string;status:string}>;pause:(id:string)=>Promise<{success:boolean}>};
export async function pauseCampaign(id:string,account:string,gateway:PauseGateway,stillOwes:()=>Promise<boolean>){
 if(!/^\d+$/.test(id)||!/^\d+$/.test(account))throw new Error('Campanha ou conta inválida');
 let remote=await gateway.get(id);if(remote.id!==id||remote.account_id!==account)throw new Error('Campanha não pertence à conta configurada');
 if(!await stillOwes())return false;
 if(['PAUSED','ARCHIVED','DELETED'].includes(remote.status))return true;
 if(remote.status!=='ACTIVE')throw new Error('Status da campanha não reconhecido para pausa');
 const result=await gateway.pause(id);if(!result.success)throw new Error('A Meta não confirmou o pedido de pausa');
 remote=await gateway.get(id);if(remote.id!==id||remote.account_id!==account||!['PAUSED','ARCHIVED','DELETED'].includes(remote.status))throw new Error('A pausa ainda não foi confirmada pela Meta');return true;
}
