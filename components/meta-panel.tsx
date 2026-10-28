'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {RefreshCw,Link,TrendingUp} from 'lucide-react';
import {MetaCampaign,Profile,Client,money} from '@/lib/types';
import {taxCents,campaignBill} from '@/lib/meta-billing';
import {presetPeriod,validatePeriod,type Period,type PeriodPreset,type CampaignReport} from '@/lib/meta-period';
const presets:{id:PeriodPreset;label:string}[]=[{id:'today',label:'Hoje'},{id:'yesterday',label:'Ontem'},{id:'week',label:'Esta semana'},{id:'7',label:'7 dias'},{id:'15',label:'15 dias'},{id:'30',label:'30 dias'},{id:'month',label:'Este mês'}];
const displayDate=(date:string)=>date.split('-').reverse().join('/');
const displayCPA=(spend:number,sales:number|undefined)=>sales!==undefined&&sales>0?money(Math.round(spend/sales)):'—';
export default function MetaPanel({campaigns,profiles,clients,admin,available,clientId}:{campaigns:MetaCampaign[];profiles:Profile[];clients:Client[];admin:boolean;available:boolean;clientId?:string}){
 const router=useRouter();
 const [remote,setRemote]=useState<{id:string;name:string}[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [period,setPeriod]=useState<Period>(()=>presetPeriod('today')),[active,setActive]=useState('today');
 const [since,setSince]=useState(period.since),[until,setUntil]=useState(period.until),[dateError,setDateError]=useState('');
 const [report,setReport]=useState<CampaignReport[]|null>(null),[loading,setLoading]=useState(false),[reportError,setReportError]=useState(''),[queriedAt,setQueriedAt]=useState(''),[refresh,setRefresh]=useState(0),[loadedReportKey,setLoadedReportKey]=useState('');
 const [reportClient,setReportClient]=useState(''),[reportCampaign,setReportCampaign]=useState('');
 const campaignChoices=campaigns.filter(c=>!reportClient||c.client_id===reportClient);
 const selectedCampaign=campaignChoices.find(c=>c.id===reportCampaign)||campaignChoices[0];
 const selectedId=selectedCampaign?.id||'';
 const selectedRows=selectedCampaign?[selectedCampaign]:[];
 const requestKey=period.since+':'+period.until+':'+selectedId;
 const campaignKey=campaigns.map(c=>c.id+':'+c.sampled_at).join(',');
 useEffect(()=>{
  if(!available||!selectedId){setReport(null);setLoading(false);return;}
  const controller=new AbortController();setLoading(true);setReport(null);setReportError('');
  fetch('/api/meta?'+new URLSearchParams({action:'insights',since:period.since,until:period.until,...(clientId?{client:clientId}:{}),campaign:selectedId}),{cache:'no-store',signal:controller.signal})
   .then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error||'Não foi possível consultar o período');if(!Array.isArray(j.rows))throw new Error('Resposta de métricas inválida');return j;})
   .then(j=>{if(!controller.signal.aborted){setReport(j.rows.filter((row:CampaignReport)=>row.id===selectedId));setLoadedReportKey(requestKey);setQueriedAt(j.queried_at);}})
   .catch(e=>{if(!controller.signal.aborted)setReportError(e instanceof Error?e.message:'Erro ao consultar métricas');})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[available,period.since,period.until,campaignKey,refresh,clientId,selectedId]);
 async function run(body?:Record<string,unknown>){
  setBusy(true);setError('');setNotice('');
  try{const r=await fetch('/api/meta',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const j=await r.json();if(!r.ok)throw new Error(j.error||'Falha na integração');if(j.errors?.length)setError(j.errors.join(' '));if(j.campaigns)setRemote(j.campaigns);else{setNotice(body?.action==='bind'?'Campanha vinculada. Referência inicial registrada.':`Sincronização concluída: ${j.updated} campanha(s) atualizada(s).`);setRefresh(v=>v+1);router.refresh();}}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 function choose(id:PeriodPreset){const next=presetPeriod(id);setPeriod(next);setSince(next.since);setUntil(next.until);setActive(id);setDateError('');}
 const spend=report?.reduce((sum,c)=>sum+c.spend_cents,0)||0,impressions=report?.reduce((sum,c)=>sum+c.impressions,0)||0,clicks=report?.reduce((sum,c)=>sum+c.clicks,0)||0;
 const tax=report?.reduce((sum,c)=>sum+taxCents(c.spend_cents),0)||0;
 const sales=report?.[0]?.sales,saleEvent=report?.[0]?.sale_event;
 const ready=report!==null&&!loading&&loadedReportKey===requestKey;
 return <>
  <section className="panel">
   <div className="panel-heading"><div><h2>Campanhas e métricas</h2><p>Histórico da Meta por período, incluindo dados anteriores ao vínculo.</p></div><button className="secondary" disabled={busy||loading||!available} onClick={()=>run({action:'sync',force:admin})}><RefreshCw size={16}/>{busy?'Atualizando…':'Atualizar métricas'}</button></div>
   <div className="meta-content">
    {!available&&<div className="notice">Integração em preparação. O administrador precisa aplicar a migração 002_meta.sql no Supabase.</div>}
    {error&&<div className="error" role="alert">{error}</div>}{notice&&<div className="notice" role="status">{notice}</div>}
    <div className="campaign-report-selectors">
     {admin&&!clientId&&<label>Cliente do relatório<select aria-label="Cliente do relatório" value={reportClient} onChange={e=>{setReportClient(e.target.value);setReportCampaign('')}}><option value="">Todos os clientes</option>{clients.filter(c=>campaigns.some(item=>item.client_id===c.id)).map(c=><option key={c.id} value={c.id}>{profiles.find(p=>p.id===c.id)?.name||'Cliente'}</option>)}</select></label>}
     <label>Campanha do relatório<select aria-label="Campanha do relatório" value={selectedId} onChange={e=>setReportCampaign(e.target.value)} disabled={!campaignChoices.length}><option value="" disabled>Nenhuma campanha vinculada</option>{campaignChoices.map(c=><option key={c.id} value={c.id}>{c.name} • {profiles.find(p=>p.id===c.client_id)?.name||'Cliente'}</option>)}</select></label>
    </div>
    {selectedCampaign&&<div className="campaign-report-context"><strong>Campanha: {selectedCampaign.name}</strong><span>Cliente: {profiles.find(p=>p.id===selectedCampaign.client_id)?.name||'Cliente'}</span><small>Os indicadores abaixo são exclusivos desta campanha e do período escolhido.</small></div>}
    <div className="period-presets" role="group" aria-label="Períodos rápidos">{presets.map(p=><button type="button" key={p.id} aria-pressed={active===p.id} className={active===p.id?'period-button selected':'period-button'} onClick={()=>choose(p.id)}>{p.label}</button>)}</div>
    <form className="period-form" onSubmit={e=>{e.preventDefault();try{const next=validatePeriod(since,until);setPeriod(next);setActive('custom');setDateError('');setRefresh(v=>v+1);}catch(e){setDateError((e as Error).message);}}}>
     <label>Data inicial<input type="date" aria-label="Data inicial das métricas" value={since} required onChange={e=>setSince(e.target.value)}/></label>
     <label>Data final<input type="date" aria-label="Data final das métricas" value={until} required onChange={e=>setUntil(e.target.value)}/></label>
     <button className="secondary" type="submit" disabled={busy}>Aplicar período</button>
    </form>
    {dateError&&<div className="error" role="alert">{dateError}</div>}
    <p className="period-caption">Período: <strong>{displayDate(period.since)} a {displayDate(period.until)}</strong> • Horário de São Paulo</p>
    {reportError&&<div className="error" role="alert">{reportError}<button className="text-button" onClick={()=>setRefresh(v=>v+1)}>Tentar novamente</button></div>}
    {loading&&<p role="status">Consultando o período na Meta…</p>}
    <div className="overview-grid campaign-metrics" aria-busy={loading}>
     <section className="mini-stat"><TrendingUp className="cyan"/><p>Gasto no período</p><strong>{ready?money(spend):'—'}</strong><small>Gasto total informado pela Meta nas datas selecionadas</small></section>
     <section className="mini-stat campaign-sales" aria-label="Vendas no período"><p>Vendas no período</p><strong>{ready&&sales!==undefined?sales.toLocaleString('pt-BR',{maximumFractionDigits:2}):'—'}</strong><small>{ready&&sales!==undefined?(saleEvent?'Compras atribuídas pela Meta no período':'Nenhum evento de compra informado pela Meta no período'):'Eventos de compra atribuídos pela Meta'}</small></section>
     <section className="mini-stat" aria-label="CPA no período"><p>CPA · custo por venda</p><strong>{ready?displayCPA(spend,sales):'—'}</strong><small>Gasto em anúncios ÷ vendas no período, sem a taxa de 12%</small></section>
     <section className="mini-stat"><p>Impressões / cliques</p><strong>{ready?`${impressions.toLocaleString('pt-BR')} / ${clicks.toLocaleString('pt-BR')}`:'—'}</strong><small>CTR: {ready?(impressions?clicks/impressions*100:0).toLocaleString('pt-BR',{maximumFractionDigits:2}):'—'}%</small></section>
     <section className="mini-stat"><p>Custo por clique</p><strong>{ready&&clicks?money(Math.round(spend/clicks)):'—'}</strong><small>Gasto dividido por cliques no período</small></section>
    </div>
    <div className="tax-summary"><span>Gasto em anúncios <strong>{ready?money(spend):'—'}</strong></span><span>Taxa informada de 12% <strong>{ready?money(tax):'—'}</strong></span><span>Total com taxa <strong>{ready?money(spend+tax):'—'}</strong></span></div>
    <div className="notice">O filtro consulta o histórico e não altera a carteira. A carteira considera o gasto desde o início do dia de ativação da campanha. A coluna “Pendente na carteira” mostra o valor atual a conciliar, independentemente do período selecionado.</div>
    {queriedAt&&ready&&<small>Relatório consultado em {new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(queriedAt))}. A Meta pode atualizar os números com atraso.</small>}
    {!campaigns.length&&<p>Nenhuma campanha vinculada ainda.</p>}
   </div>
   <div className="table-wrap"><table><thead><tr><th>Campanha</th>{admin&&<th>Cliente</th>}<th>Vendas</th><th>CPA</th><th>Gasto no período</th><th>Taxa 12%</th><th>Total com taxa</th><th>Impressões</th><th>Cliques</th><th>Pendente na carteira</th><th>Última sincronização financeira</th></tr></thead>
    <tbody>{selectedRows.map(c=>{const metric=ready?report?.find(row=>row.id===c.id):undefined;return <tr key={c.id}>
     <td><strong>{c.name}</strong><small style={{display:'block'}}>Vínculo em {new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo'}).format(new Date(c.bound_at))}</small>{c.last_error&&<small className="negative" style={{display:'block',whiteSpace:'normal',maxWidth:280}}>{c.last_error}</small>}</td>
     {admin&&<td>{profiles.find(p=>p.id===c.client_id)?.name||'Cliente'}</td>}
     <td>{metric?.sales!==undefined?metric.sales.toLocaleString('pt-BR',{maximumFractionDigits:2}):'—'}</td><td>{metric?displayCPA(metric.spend_cents,metric.sales):'—'}</td>
     <td>{metric?money(metric.spend_cents):'—'}</td><td>{metric?money(taxCents(metric.spend_cents)):'—'}</td><td>{metric?money(metric.spend_cents+taxCents(metric.spend_cents)):'—'}</td><td>{metric?metric.impressions.toLocaleString('pt-BR'):'—'}</td><td>{metric?metric.clicks.toLocaleString('pt-BR'):'—'}</td>
     <td>{money(campaignBill(c).pending)}</td><td>{new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(c.sampled_at))}</td>
    </tr>;})}</tbody></table></div>
  </section>
  {admin&&!clientId&&<section className="panel"><div className="panel-heading"><div><h2>Vincular campanha ao cliente</h2><p>Cada campanha pertence a um único cliente. O histórico estará disponível; o gasto de todo o dia de ativação será descontado da carteira.</p></div><button disabled={busy||!available} className="secondary" onClick={()=>run()}><RefreshCw size={16}/> Buscar campanhas da Meta</button></div>
   <form className="form-grid" onSubmit={e=>{e.preventDefault();run({action:'bind',...Object.fromEntries(new FormData(e.currentTarget))})}}>
    <label>Campanha<select aria-label="Campanha" name="campaign_id" required defaultValue=""><option value="" disabled>Busque e selecione uma campanha</option>{remote.filter(c=>!campaigns.some(b=>b.id===c.id)).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>Cliente<select aria-label="Cliente" name="client_id" required defaultValue=""><option value="" disabled>Selecione um cliente</option>{clients.filter(c=>profiles.find(p=>p.id===c.id)?.active).map(c=><option key={c.id} value={c.id}>{profiles.find(p=>p.id===c.id)?.name}</option>)}</select></label>
    <label className="checkbox full"><input type="checkbox" required/> Conferi o cliente e autorizo descontar todo o gasto do dia de ativação mais a taxa de 12%.</label><button className="primary" disabled={busy||!available||!remote.length}><Link size={16}/> Vincular campanha</button>
   </form>
  </section>}
 </>;
}
