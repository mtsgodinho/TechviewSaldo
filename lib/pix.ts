export function crc16(value: string) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(value)) { crc ^= byte << 8; for (let i=0;i<8;i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff; }
  return crc.toString(16).toUpperCase().padStart(4,'0');
}
function field(id:string,value:string) { const length=new TextEncoder().encode(value).length; if(length>99) throw new Error('Campo Pix muito longo'); return id+String(length).padStart(2,'0')+value; }
const clean=(s:string,max:number)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9 $%*+\-./:]/g,'').slice(0,max).trim();
export function pixPayload(input:{key:string;name:string;city:string;cents:number;txid:string}) {
 if(!Number.isSafeInteger(input.cents)||input.cents<=0||input.cents>99999999) throw new Error('Valor inválido');
 if(!input.key.trim() || new TextEncoder().encode(input.key).length>77 || !/^[a-zA-Z0-9]{1,25}$/.test(input.txid)) throw new Error('Configuração Pix inválida');
 const name=clean(input.name,25),city=clean(input.city,15); if(!name||!city) throw new Error('Recebedor inválido');
 const base=field('00','01')+field('26',field('00','br.gov.bcb.pix')+field('01',input.key.trim()))+field('52','0000')+field('53','986')+field('54',(input.cents/100).toFixed(2))+field('58','BR')+field('59',name)+field('60',city)+field('62',field('05',input.txid))+'6304';
 return base+crc16(base);
}
export function parseCents(value:string) { if(!/^\d{1,6}([.,]\d{1,2})?$/.test(value)) throw new Error('Informe um valor válido, com até duas casas decimais'); const [a,b='']=value.replace(',','.').split('.'); const cents=Number(a)*100+Number(b.padEnd(2,'0')); if(cents<=0) throw new Error('O valor deve ser positivo'); return cents; }
