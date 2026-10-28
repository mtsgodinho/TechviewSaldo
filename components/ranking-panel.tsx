'use client';
import {useEffect,useState} from 'react';
import {Trophy,Medal,Search,RefreshCw,ChevronLeft,ChevronRight} from 'lucide-react';
import {presetPeriod,validatePeriod,type Period,type PeriodPreset} from '@/lib/meta-period';
import {conversion,orderRanking,type RankedClient,type RankingOrder} from '@/lib/meta-ranking';
const shortcuts:{id:PeriodPreset;label:string}[]=[{id:'today',label:'Hoje'},{id:'yesterday',label:'Ontem'},{id:'week',label:'Esta semana'},{id:'7',label:'7 dias'},{id:'14',label:'14 dias'},{id:'15',label:'15 dias'},{id:'month',label:'Este mês'},{id:'30',label:'30 dias'},{id:'90',label:'90 dias'},{id:'all',label:'Todos (até 36 meses)'}];
const number=(value:number)=>value.toLocaleString('pt-BR',{maximumFractionDigits:2});
const percent=(value:number|null)=>value===null?'—':number(value)+'%';
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
export default function RankingPanel(){
 const [period,setPeriod]=useState<Period>(()=>presetPeriod('today')),[active,setActive]=useState('today'),[since,setSince]=useState(period.since),[until,setUntil]=useState(period.until);
 const [rows,setRows]=useState<RankedClient[]|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[dateError,setDateError]=useState(''),[queriedAt,setQueriedAt]=useState(''),[reload,setReload]=useState(0);
 const [search,setSearch]=useState(''),[order,setOrder]=useState<RankingOrder>('sales'),[page,setPage]=useState(1);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setRows(null);setError('');setPage(1);
  fetch('/api/ranking?'+new URLSearchParams(period),{cache:'no-store',signal:controller.signal})
   .then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error||'Não foi possível consultar o ranking');if(!Array.isArray(data.rows))throw new Error('Resposta do ranking inválida');return data;})
   .then(data=>{if(!controller.signal.aborted){setRows(data.rows);setQueriedAt(data.queried_at);}})
   .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Falha ao consultar a Meta');})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});return ()=>controller.abort();
 },[period.since,period.until,reload]);
 function choose(preset:PeriodPreset){const next=presetPeriod(preset);setPeriod(next);setSince(next.since);setUntil(next.until);setActive(preset);setDateError('');}
 const ranked=orderRanking(rows||[],order).map((row,index)=>({...row,position:index+1}));
 const filtered=ranked.filter(row=>normalize(row.name).includes(normalize(search))),pages=Math.max(1,Math.ceil(filtered.length/25)),current=Math.min(page,pages),visible=filtered.slice((current-1)*25,current*25);
 const winners=orderRanking(rows||[]).filter(row=>row.sales>0).slice(0,3).map((row,index)=>({...row,position:index+1}));
 const podium=winners.length===3?[winners[1],winners[0],winners[2]]:winners;
 const leads=rows?.reduce((sum,row)=>sum+row.leads,0)||0,sales=rows?.reduce((sum,row)=>sum+row.sales,0)||0;
 return <section className="panel ranking-panel">
  <div className="panel-heading"><div><h2>Ranking de vendas</h2><p>Resultados atribuídos pela Meta às campanhas vinculadas de cada cliente.</p></div><button className="secondary" disabled={loading} onClick={()=>setReload(v=>v+1)}><RefreshCw size={16}/> Atualizar ranking</button></div>
  <div className="meta-content">
   <div className="period-presets" role="group" aria-label="Períodos do ranking">{shortcuts.map(p=><button className={active===p.id?'period-button selected':'period-button'} aria-pressed={active===p.id} key={p.id} onClick={()=>choose(p.id)}>{p.label}</button>)}</div>
   <form className="period-form" onSubmit={e=>{e.preventDefault();try{setPeriod(validatePeriod(since,until));setActive('custom');setDateError('');setReload(v=>v+1);}catch(e){setDateError((e as Error).message);}}}>
    <label>Data inicial<input type="date" aria-label="Data inicial do ranking" value={since} required onChange={e=>setSince(e.target.value)}/></label><label>Data final<input type="date" aria-label="Data final do ranking" value={until} required onChange={e=>setUntil(e.target.value)}/></label><button className="secondary">Aplicar período</button>
   </form>
   <p className="period-caption">{period.since.split('-').reverse().join('/')} a {period.until.split('-').reverse().join('/')} • Horário de São Paulo</p>
   {dateError&&<div className="error" role="alert">{dateError}</div>}{error&&<div className="error" role="alert">{error}<button className="text-button" onClick={()=>setReload(v=>v+1)}>Tentar novamente</button></div>}
   {loading&&<p role="status">Consultando os eventos na Meta…</p>}
   {rows!==null&&<><div className="ranking-totals"><span>Leads atribuídos<strong>{number(leads)}</strong></span><span>Vendas atribuídas<strong>{number(sales)}</strong></span><span>Vendas / leads<strong>{percent(leads>0?sales/leads*100:null)}</strong></span></div>
    {podium.length>0?<div className="ranking-podium">{podium.map(row=><article className={'podium-card place-'+row.position} key={row.id}>{row.position===1?<Trophy size={30}/>:<Medal size={28}/>}<span className="podium-place">{row.position}º lugar</span><strong>{row.name}</strong><b>{number(row.sales)} <small>vendas</small></b><small>{number(row.leads)} leads • {percent(conversion(row))} vendas/leads</small></article>)}</div>:<div className="notice">Ainda não há eventos de compra atribuídos às campanhas vinculadas neste período. Isso não comprova ausência de vendas fora da Meta.</div>}
    <div className="ranking-controls"><label className="search"><Search size={17}/><input aria-label="Pesquisar cliente no ranking" placeholder="Pesquisar cliente ou revenda…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/></label><label>Ordenar por<select aria-label="Ordenar ranking" value={order} onChange={e=>{setOrder(e.target.value as RankingOrder);setPage(1)}}><option value="sales">Vendas</option><option value="leads">Leads</option><option value="conversion">Vendas / leads</option></select></label></div>
   </>}
  </div>
  {rows!==null&&<><div className="table-wrap"><table><thead><tr><th>Posição</th><th>Cliente / revenda</th><th>Leads atribuídos</th><th>Vendas atribuídas</th><th>Vendas / leads</th></tr></thead><tbody>{visible.map(row=><tr key={row.id}><td><span className={'rank-badge rank-'+row.position}>{row.position}º</span></td><td><div className="transaction-name"><span className="avatar">{row.name.slice(0,2).toUpperCase()}</span><div><strong>{row.name}</strong><small>{row.campaigns?`${row.campaigns} campanha(s) vinculada(s)`:'Sem campanha vinculada'}</small></div></div><div className="rank-bar" aria-hidden="true"><span style={{width:`${Math.max(0,Math.min(100,sales?row.sales/Math.max(...ranked.map(r=>r.sales),1)*100:0))}%`}}/></div></td><td><strong>{number(row.leads)}</strong>{!row.lead_events.length&&<small className="event-note">Sem evento de lead no período</small>}</td><td className="positive"><strong>{number(row.sales)}</strong>{!row.sale_events.length&&<small className="event-note">Sem evento de compra no período</small>}</td><td>{percent(conversion(row))}</td></tr>)}</tbody></table>{!visible.length&&<div className="empty">Nenhum cliente encontrado.</div>}</div>
   <div className="ranking-footer"><span>{filtered.length} cliente(s) • Página {current} de {pages}</span><div className="actions"><button className="secondary" aria-label="Página anterior do ranking" disabled={current===1} onClick={()=>setPage(current-1)}><ChevronLeft size={16}/></button><button className="secondary" aria-label="Próxima página do ranking" disabled={current===pages} onClick={()=>setPage(current+1)}><ChevronRight size={16}/></button></div></div></>}
  <div className="meta-content"><small>Fonte: eventos atribuídos pela Meta, conforme a janela de atribuição dos conjuntos de anúncios, agrupados pela data da impressão. Cliques e conversas não são convertidos em leads. Os resultados podem diferir do CRM ou do funil real; vendas/leads é uma razão entre eventos e pode superar 100%. Eventos agregados e subtipos não são somados entre si. O ranking não altera o saldo.</small>{queriedAt&&rows!==null&&<small style={{display:'block',marginTop:10}}>Consultado em {new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(queriedAt))}.</small>}</div>
 </section>;
}
