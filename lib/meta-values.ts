export function metaCents(value:string){
 if(!/^\d{1,12}(\.\d{1,2})?$/.test(value))throw new Error('Valor da Meta inválido');
 const [whole,fraction='']=value.split('.');const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(cents))throw new Error('Valor da Meta fora do limite');return cents;
}
export function counter(value:string|undefined){if(value===undefined)return 0;if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw new Error('Métrica da Meta inválida');return Number(value);}
export function accountDate(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
