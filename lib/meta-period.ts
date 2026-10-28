import {accountDate} from './meta-values';
export type PeriodPreset='today'|'yesterday'|'week'|'7'|'15'|'30'|'month';
export type Period={since:string;until:string};
function shift(day:string,days:number){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function presetPeriod(preset:PeriodPreset,now=new Date()):Period{
 const today=accountDate(now);
 if(preset==='yesterday'){const yesterday=shift(today,-1);return {since:yesterday,until:yesterday};}
 if(preset==='week'){const day=new Date(today+'T12:00:00Z').getUTCDay();return {since:shift(today,-((day+6)%7)),until:today};}
 if(preset==='month')return {since:today.slice(0,8)+'01',until:today};
 const days=preset==='today'?1:Number(preset);return {since:shift(today,1-days),until:today};
}
export function validatePeriod(since:string,until:string,now=new Date()):Period{
 for(const day of [since,until])if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T12:00:00Z'))||new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day)throw new Error('Informe datas válidas');
 if(since>until)throw new Error('A data inicial deve ser anterior à final');
 if(until>accountDate(now))throw new Error('A data final não pode estar no futuro');
 const earliest=new Date(accountDate(now)+'T12:00:00Z');earliest.setUTCFullYear(earliest.getUTCFullYear()-3);
 if(since<earliest.toISOString().slice(0,10))throw new Error('Consulte um período dentro dos últimos 36 meses');
 return {since,until};
}
export type CampaignReport={id:string;spend_cents:number;impressions:number;clicks:number};
