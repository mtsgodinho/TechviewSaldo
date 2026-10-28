// Pagamento em USDT, usando 1 USDT = 1 USD como referência comercial.
export const RATE_SOURCE='AwesomeAPI USD/BRL';
export type PolygonRate={rate_micro_brl:number;quoted_at:string;fetched_at:string;source:string};
export function readPolygonRate(value:unknown,now=Date.now()):PolygonRate{
 const row=(value as {USDBRL?:{code?:unknown;codein?:unknown;bid?:unknown;timestamp?:unknown}})?.USDBRL;
 if(!row||row.code!=='USD'||row.codein!=='BRL'||typeof row.bid!=='string'||!/^\d{1,6}(\.\d{1,8})?$/.test(row.bid)||typeof row.timestamp!=='string'||!/^\d{10}$/.test(row.timestamp))throw new Error('Cotação USD/BRL inválida');
 const quotedAt=Number(row.timestamp)*1000;
 if(now-quotedAt>600000||quotedAt-now>15000)throw new Error('Cotação USD/BRL desatualizada');
 const [whole,fraction='']=row.bid.split('.');const price=BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,'0'));const rate=Number((price+50n)/100n);
 if(!Number.isSafeInteger(rate)||rate<1||rate>999999999999)throw new Error('Cotação USD/BRL fora do intervalo permitido');
 return {rate_micro_brl:rate,quoted_at:new Date(quotedAt).toISOString(),fetched_at:new Date(now).toISOString(),source:RATE_SOURCE};
}
export async function fetchPolygonRate(fetcher:typeof fetch=fetch):Promise<PolygonRate>{
 try{const response=await fetcher('https://economia.awesomeapi.com.br/json/last/USD-BRL',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error();return readPolygonRate(await response.json());}
 catch{throw new Error('Cotação automática do dólar indisponível ou desatualizada. Tente novamente em instantes; nenhum pagamento foi gerado com cotação antiga.');}
}
