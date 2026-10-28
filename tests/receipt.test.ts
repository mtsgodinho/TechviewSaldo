import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import {readReceipt,ReceiptError,type ReceiptReader} from '../lib/receipt';
import {receiptPDF} from '../lib/receipt-pdf';
import {confirmedRequest,receiptTransaction,receiptId} from './fixtures/receipt';
const reader:ReceiptReader={request:async()=>({...confirmedRequest}),transaction:async()=>({...receiptTransaction}),clientName:async()=> 'Cliente de teste — João da Conceição'};
test('receipt uses only confirmed Pix and a matching wallet ledger entry, preserving exact cents and dates',async()=>{
 const receipt=await readReceipt(receiptId,reader);assert.equal(receipt.amount_cents,15009);assert.equal(receipt.confirmed_at,confirmedRequest.reviewed_at);assert.equal(receipt.transaction_id,receiptTransaction.id);
 assert.equal((await readReceipt(receiptId,reader)).id,receipt.id);
 for(const status of ['awaiting','informed','rejected'])await assert.rejects(readReceipt(receiptId,{...reader,request:async()=>({...confirmedRequest,status})}),e=>e instanceof ReceiptError&&e.status===409);
 await assert.rejects(readReceipt(receiptId,{...reader,request:async()=>null}),e=>e instanceof ReceiptError&&e.status===404);
 for(const invalid of [null,{...receiptTransaction,amount_cents:15010},{...receiptTransaction,client_id:'other'},{...receiptTransaction,pix_request_id:'other'},{...receiptTransaction,type:'manual_credit'}])await assert.rejects(readReceipt(receiptId,{...reader,transaction:async()=>invalid}),/conferir o lançamento/);
 for(const invalid of [{...confirmedRequest,reviewed_at:null},{...confirmedRequest,reviewed_at:'invalid'},{...confirmedRequest,amount_cents:-15009}])await assert.rejects(readReceipt(receiptId,{...reader,request:async()=>invalid}),/conferir o lançamento/);
});
test('TechView receipt produces a single printable PDF with original confirmation metadata and resilient long text',async()=>{
 const receipt=await readReceipt(receiptId,reader),icon=await readFile('public/icons/techview-192.png');const bytes=await receiptPDF(receipt,icon);
 assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');const pdf=await PDFDocument.load(bytes);assert.equal(pdf.getPageCount(),1);assert.equal(pdf.getAuthor(),'TechView');assert.equal(pdf.getCreationDate()?.toISOString(),confirmedRequest.reviewed_at?.replace('Z','.000Z'));assert.match(pdf.getTitle()!,/Comprovante de recarga Pix/);
 await writeFile('/tmp/techview-receipt-preview.pdf',bytes);
 const long=await receiptPDF({...receipt,client_name:'João Çã 😀 '+ 'Nome muito comprido '.repeat(6),amount_cents:99999999},icon);assert.equal((await PDFDocument.load(long)).getPageCount(),1);
});
