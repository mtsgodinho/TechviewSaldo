import {NextResponse} from 'next/server';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {actor} from '@/lib/supabase';
import {readReceipt,ReceiptError} from '@/lib/receipt';
import {receiptPDF} from '@/lib/receipt-pdf';
export const runtime='nodejs';
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){
 let authorized=false;
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 try{
  const {db}=await actor();authorized=true;const {id}=await params;if(!z.uuid().safeParse(id).success)throw new ReceiptError('Comprovante não encontrado',404);
  const receipt=await readReceipt(id,{
   request:async key=>{const {data,error}=await db.from('pix_requests').select('id,client_id,status,amount_cents,txid,receiver_name,bank,reviewed_at').eq('id',key).maybeSingle();if(error)throw new Error('Falha na consulta');return data;},
   transaction:async key=>{const {data,error}=await db.from('wallet_transactions').select('id,client_id,type,amount_cents,pix_request_id,created_at').eq('pix_request_id',key).maybeSingle();if(error)throw new Error('Falha na consulta');return data;},
   clientName:async key=>{const {data,error}=await db.from('profiles').select('name').eq('id',key).maybeSingle();if(error)throw new Error('Falha na consulta');return data?.name||null;}
  });
  const icon=await readFile(path.join(process.cwd(),'public/icons/techview-192.png')),bytes=await receiptPDF(receipt,icon);
  return new NextResponse(new Uint8Array(bytes),{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="TechView-comprovante-${id}.pdf"`}});
 }catch(e){return NextResponse.json({error:!authorized?'Entre na sua conta para baixar o comprovante':e instanceof ReceiptError?e.message:'Não foi possível gerar o comprovante. Tente novamente.'},{status:!authorized?403:e instanceof ReceiptError?e.status:500,headers});}
}
