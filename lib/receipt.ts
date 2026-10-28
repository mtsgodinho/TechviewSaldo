export type ReceiptRequest={id:string;client_id:string;status:string;amount_cents:number;txid:string;receiver_name:string;bank:string;reviewed_at:string|null};
export type ReceiptTransaction={id:string;client_id:string;type:string;amount_cents:number;pix_request_id:string|null;created_at:string};
export type Receipt={id:string;transaction_id:string;client_name:string;amount_cents:number;txid:string;receiver_name:string;bank:string;confirmed_at:string};
export class ReceiptError extends Error{constructor(message:string,public status:number){super(message);}}
export type ReceiptReader={request:(id:string)=>Promise<ReceiptRequest|null>;transaction:(id:string)=>Promise<ReceiptTransaction|null>;clientName:(id:string)=>Promise<string|null>};
// O leitor do servidor usa a sessão autenticada e RLS. Nenhum dado financeiro vem do navegador.
export async function readReceipt(id:string,reader:ReceiptReader):Promise<Receipt>{
 const request=await reader.request(id);
 if(!request)throw new ReceiptError('Comprovante não encontrado ou sem permissão de acesso',404);
 if(request.status!=='confirmed')throw new ReceiptError('O comprovante fica disponível após a confirmação do Pix',409);
 const [transaction,name]=await Promise.all([reader.transaction(id),reader.clientName(request.client_id)]);
 const cents=Number(request.amount_cents),confirmed=request.reviewed_at;
 if(request.id!==id||!transaction||transaction.pix_request_id!==id||transaction.client_id!==request.client_id||transaction.type!=='pix'||Number(transaction.amount_cents)!==cents||!Number.isSafeInteger(cents)||cents<=0||!confirmed||!Number.isFinite(Date.parse(confirmed))||!name)throw new ReceiptError('Não foi possível conferir o lançamento desta recarga. Fale com o administrador.',409);
 return {id:request.id,transaction_id:transaction.id,client_name:name,amount_cents:cents,txid:request.txid,receiver_name:request.receiver_name,bank:request.bank,confirmed_at:confirmed};
}
