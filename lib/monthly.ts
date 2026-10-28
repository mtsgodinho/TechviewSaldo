export type MonthlySetting={client_id:string;amount_cents:number;updated_at:string;updated_by:string};
export type MonthlyCycle={id:string;client_id:string;amount_cents:number;starts_at:string;ends_at:string;activated_by:string;request_id:string};
export function monthlyStatus(cycle:MonthlyCycle|undefined,now:string){if(!cycle)return 'unactivated';return Date.parse(now)>=Date.parse(cycle.ends_at)?'expired':'active';}
export function latestMonthlyCycle(cycles:MonthlyCycle[],client:string){return cycles.filter(c=>c.client_id===client).sort((a,b)=>Date.parse(b.starts_at)-Date.parse(a.starts_at)||a.id.localeCompare(b.id))[0];}
export const monthlyLabels={unactivated:'Não ativada',active:'Ativa',expired:'Vencida'};

export type MonthlyRequest={id:string;client_id:string;amount_cents:number;txid:string;payload:string;receiver_name:string;bank:string;status:'awaiting'|'informed'|'confirmed'|'rejected';created_at:string;qr?:string};
