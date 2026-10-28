'use client';
import {useState} from 'react';
import {FileDown} from 'lucide-react';
export default function ReceiptButton({id}:{id:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function download(){setBusy(true);setError('');try{
  const response=await fetch(`/api/receipts/${encodeURIComponent(id)}`,{cache:'no-store'});
  if(!response.ok){const body=await response.json();throw new Error(body.error||'Não foi possível baixar o comprovante');}
  if(!response.headers.get('Content-Type')?.includes('application/pdf'))throw new Error('Resposta de comprovante inválida. Tente novamente.');
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`TechView-comprovante-${id}.pdf`;document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch(e){setError(e instanceof Error?e.message:'Não foi possível baixar o comprovante');}finally{setBusy(false);}}
 return <span className="receipt-action"><button type="button" className="text-button" disabled={busy} onClick={download}><FileDown size={15}/>{busy?'Preparando comprovante…':'Baixar comprovante'}</button>{error&&<small className="negative" role="alert">{error}</small>}</span>;
}
