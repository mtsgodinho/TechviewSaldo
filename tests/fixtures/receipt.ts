import type {ReceiptRequest,ReceiptTransaction} from '../../lib/receipt';
export const receiptId='66666666-6666-4666-8666-666666666666';
export const receiptClient='22222222-2222-4222-8222-222222222222';
export const confirmedRequest:ReceiptRequest={id:receiptId,client_id:receiptClient,status:'confirmed',amount_cents:15009,txid:'TECHVIEWTEST15009',receiver_name:'TECHVIEW TESTE',bank:'Nubank',reviewed_at:'2026-10-28T18:30:25Z'};
export const receiptTransaction:ReceiptTransaction={id:'77777777-7777-4777-8777-777777777777',client_id:receiptClient,type:'pix',amount_cents:15009,pix_request_id:receiptId,created_at:confirmedRequest.reviewed_at!};
