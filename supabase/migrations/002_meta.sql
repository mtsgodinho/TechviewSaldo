-- Execute uma vez após schema.sql. Não reaplique o schema inicial no banco em uso.
begin;
create table public.meta_campaigns (
 id text primary key check(id ~ '^[0-9]+$'), account_id text not null check(account_id ~ '^[0-9]+$'),
 client_id uuid not null references public.clients(id), name text not null,
 started_on date not null, bound_at timestamptz not null default now(), bound_by uuid not null references public.profiles(id),
 baseline_cents bigint not null check(baseline_cents>=0), observed_cents bigint not null check(observed_cents>=baseline_cents),
 charged_cents bigint not null default 0 check(charged_cents>=0),
 baseline_impressions bigint not null, baseline_clicks bigint not null,
 impressions bigint not null, clicks bigint not null,
 sampled_at timestamptz not null, last_error text,
 check(charged_cents<=observed_cents-baseline_cents)
);
create index on public.meta_campaigns(client_id);
alter table public.meta_campaigns enable row level security;
create policy meta_campaigns_read on public.meta_campaigns for select to authenticated using (public.is_admin() or (client_id=auth.uid() and public.is_active()));
revoke all on public.meta_campaigns from anon,authenticated;
grant select on public.meta_campaigns to authenticated;
grant select,update on public.meta_campaigns to service_role;
-- Actor é validado novamente no banco; RPCs aceitam somente service_role.
create function public.bind_meta_campaign(p_id text,p_account text,p_client uuid,p_name text,p_date date,p_spend bigint,p_impressions bigint,p_clicks bigint,p_sampled timestamptz,p_admin uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from profiles where id=p_admin and role='admin' and active) then raise exception 'Acesso não autorizado';end if;
 if not exists(select 1 from profiles p join clients c on c.id=p.id where p.id=p_client and p.active) then raise exception 'Cliente inativo ou inexistente';end if;
 if least(p_spend,p_impressions,p_clicks)<0 then raise exception 'Métricas inválidas';end if;
 insert into meta_campaigns(id,account_id,client_id,name,started_on,bound_by,baseline_cents,observed_cents,baseline_impressions,baseline_clicks,impressions,clicks,sampled_at)
 values(p_id,p_account,p_client,p_name,p_date,p_admin,p_spend,p_spend,p_impressions,p_clicks,p_impressions,p_clicks,p_sampled);
 insert into audit_logs(actor_id,action,entity_id,details) values(p_admin,'meta_campaign_bound',p_client,jsonb_build_object('campaign',p_id,'baseline_cents',p_spend,'started_on',p_date));
end $$;
create function public.apply_meta_snapshot(p_id text,p_spend bigint,p_impressions bigint,p_clicks bigint,p_sampled timestamptz)
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare c meta_campaigns;b bigint;owed bigint;debit bigint;
begin
 if least(p_spend,p_impressions,p_clicks)<0 or p_sampled>now()+interval '5 minutes' then raise exception 'Métricas inválidas';end if;
 select * into c from meta_campaigns where id=p_id for update;
 if not found then raise exception 'Campanha não vinculada';end if;
 -- Relatórios atrasados não substituem observações mais recentes. Repetição é inofensiva.
 if p_sampled<c.sampled_at then return 0;end if;
 -- Mantém maior gasto confirmado: correções negativas exigem estorno manual auditado.
 owed=greatest(c.observed_cents,p_spend)-c.baseline_cents-c.charged_cents;
 select balance_cents into b from wallets where client_id=c.client_id for update;
 debit=least(owed,b);
 if debit>0 then
  update wallets set balance_cents=balance_cents-debit where client_id=c.client_id;
  insert into wallet_transactions(client_id,type,amount_cents,description,balance_before,balance_after,actor_id,operation_id,occurred_on)
  values(c.client_id,'meta_ads',-debit,'Gasto automático Meta Ads • '||c.name,b,b-debit,c.bound_by,gen_random_uuid(),(now() at time zone 'America/Sao_Paulo')::date);
  insert into audit_logs(actor_id,action,entity_id,details) values(c.bound_by,'meta_spend_synced',c.client_id,jsonb_build_object('campaign',p_id,'debit_cents',debit,'before',b,'after',b-debit,'source','meta_api','sampled_at',p_sampled));
 end if;
 update meta_campaigns set observed_cents=greatest(observed_cents,p_spend),charged_cents=charged_cents+debit,impressions=p_impressions,clicks=p_clicks,sampled_at=p_sampled,last_error=case when p_spend<c.observed_cents then 'A Meta reduziu o gasto informado. Revisão manual necessária; nenhum estorno automático.' else null end where id=p_id;
 return debit;
end $$;
revoke execute on function public.bind_meta_campaign(text,text,uuid,text,date,bigint,bigint,bigint,timestamptz,uuid),public.apply_meta_snapshot(text,bigint,bigint,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.bind_meta_campaign(text,text,uuid,text,date,bigint,bigint,bigint,timestamptz,uuid),public.apply_meta_snapshot(text,bigint,bigint,bigint,timestamptz) to service_role;
-- Evita lançar abastecimento manual como gasto sobre campanhas já sincronizadas.
create or replace function public.adjust_wallet(p_client uuid,p_cents bigint,p_type text,p_reason text,p_date date,p_operation uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare b bigint;delta bigint;begin perform require_admin();
if p_cents<=0 or p_cents>99999999 or p_type not in ('manual_credit','manual_debit','meta_ads','refund') or length(trim(p_reason))<3 then raise exception 'Movimentação inválida';end if;
if p_type='meta_ads' and exists(select 1 from meta_campaigns where client_id=p_client) then raise exception 'Este cliente usa gasto automático. Não registre abastecimento como gasto novamente.';end if;
select balance_cents into b from wallets where client_id=p_client for update;if not found then raise exception 'Cliente não encontrado';end if;
if exists(select 1 from wallet_transactions where operation_id=p_operation) then return;end if;
delta=case when p_type in ('manual_debit','meta_ads') then -p_cents else p_cents end;if b+delta<0 then raise exception 'Saldo insuficiente';end if;
update wallets set balance_cents=b+delta where client_id=p_client;
insert into wallet_transactions(client_id,type,amount_cents,description,balance_before,balance_after,actor_id,operation_id,occurred_on) values(p_client,p_type,delta,p_reason,b,b+delta,auth.uid(),p_operation,p_date);
insert into audit_logs(actor_id,action,entity_id,details) values(auth.uid(),'wallet_adjusted',p_client,jsonb_build_object('amount_cents',delta,'before',b,'after',b+delta,'reason',p_reason));end $$;
commit;
