-- Execute uma vez após 002_meta.sql. Concilia dia de ativação e taxa informada de 12%.
-- Não reaplique schema.sql. A transação inteira é revertida se ocorrer algum erro.
begin;
alter table public.meta_campaigns add column charged_spend_cents bigint not null default 0,add column charged_tax_cents bigint not null default 0;
update public.meta_campaigns set charged_spend_cents=charged_cents;
do $$ declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.meta_campaigns'::regclass and contype='c' and pg_get_constraintdef(oid) like '%charged_cents%' and pg_get_constraintdef(oid) like '%observed_cents%' loop
 execute format('alter table public.meta_campaigns drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.meta_campaigns add constraint meta_paid_breakdown check(charged_spend_cents>=0 and charged_tax_cents>=0 and charged_cents=charged_spend_cents+charged_tax_cents),add constraint meta_gross_limit check(charged_cents<=(observed_cents-baseline_cents)+((observed_cents-baseline_cents)*12+50)/100);
alter table public.wallet_transactions add column ad_spend_cents bigint not null default 0 check(ad_spend_cents>=0),add column tax_cents bigint not null default 0 check(tax_cents>=0);
update public.wallet_transactions set ad_spend_cents=-amount_cents where type='meta_ads' and description like 'Gasto automático Meta Ads%';
alter table public.wallet_transactions add constraint meta_transaction_breakdown check((ad_spend_cents=0 and tax_cents=0) or (type='meta_ads' and ad_spend_cents+tax_cents=-amount_cents));
create or replace function public.apply_meta_snapshot(p_id text,p_spend bigint,p_impressions bigint,p_clicks bigint,p_sampled timestamptz)
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare c meta_campaigns;b bigint;base bigint;tax bigint;owed bigint;debit bigint;principal_part bigint;tax_part bigint;
begin
 if least(p_spend,p_impressions,p_clicks)<0 or p_sampled>now()+interval '5 minutes' then raise exception 'Métricas inválidas';end if;
 select * into c from meta_campaigns where id=p_id for update;if not found then raise exception 'Campanha não vinculada';end if;
 if p_sampled<c.sampled_at then return 0;end if;
 base=greatest(c.observed_cents,p_spend)-c.baseline_cents;
 tax=(base*12+50)/100;owed=base+tax-c.charged_cents;
 select balance_cents into b from wallets where client_id=c.client_id for update;debit=least(owed,b);
 principal_part=least(greatest(base-c.charged_spend_cents,0),debit);tax_part=debit-principal_part;
 if debit>0 then
  update wallets set balance_cents=balance_cents-debit where client_id=c.client_id;
  insert into wallet_transactions(client_id,type,amount_cents,description,balance_before,balance_after,actor_id,operation_id,occurred_on,ad_spend_cents,tax_cents)
  values(c.client_id,'meta_ads',-debit,'Gasto Meta Ads + taxa de 12% • '||c.name,b,b-debit,c.bound_by,gen_random_uuid(),(now() at time zone 'America/Sao_Paulo')::date,principal_part,tax_part);
  insert into audit_logs(actor_id,action,entity_id,details) values(c.bound_by,'meta_spend_synced',c.client_id,jsonb_build_object('campaign',p_id,'debit_cents',debit,'ad_spend_cents',principal_part,'tax_cents',tax_part,'rate_percent',12,'before',b,'after',b-debit,'source','meta_api','sampled_at',p_sampled));
 end if;
 update meta_campaigns set observed_cents=greatest(observed_cents,p_spend),charged_cents=charged_cents+debit,charged_spend_cents=charged_spend_cents+principal_part,charged_tax_cents=charged_tax_cents+tax_part,impressions=p_impressions,clicks=p_clicks,sampled_at=p_sampled,last_error=case when p_spend<c.observed_cents then 'A Meta reduziu o gasto informado. Revisão manual necessária; nenhum estorno automático.' else null end where id=p_id;
 return debit;
end $$;
create or replace function public.bind_meta_campaign(p_id text,p_account text,p_client uuid,p_name text,p_date date,p_spend bigint,p_impressions bigint,p_clicks bigint,p_sampled timestamptz,p_admin uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from profiles where id=p_admin and role='admin' and active) then raise exception 'Acesso não autorizado';end if;
 if not exists(select 1 from profiles p join clients c on c.id=p.id where p.id=p_client and p.active) then raise exception 'Cliente inativo ou inexistente';end if;
 if least(p_spend,p_impressions,p_clicks)<0 then raise exception 'Métricas inválidas';end if;
 insert into meta_campaigns(id,account_id,client_id,name,started_on,bound_by,baseline_cents,observed_cents,baseline_impressions,baseline_clicks,impressions,clicks,sampled_at)
 values(p_id,p_account,p_client,p_name,p_date,p_admin,0,p_spend,0,0,p_impressions,p_clicks,p_sampled);
 insert into audit_logs(actor_id,action,entity_id,details) values(p_admin,'meta_campaign_bound',p_client,jsonb_build_object('campaign',p_id,'billing_start',p_date,'includes_activation_day',true));
 -- Débito em conjunto com o vínculo, sem aguardar outra atualização.
 perform public.apply_meta_snapshot(p_id,p_spend,p_impressions,p_clicks,p_sampled);
end $$;
do $$
declare c public.meta_campaigns;
begin
 for c in select * from public.meta_campaigns where started_on='2026-10-28' and baseline_cents>0 order by id for update loop
  update public.meta_campaigns set baseline_cents=0,baseline_impressions=0,baseline_clicks=0 where id=c.id;
  insert into public.audit_logs(actor_id,action,entity_id,details)
  values(c.bound_by,'meta_activation_day_included',c.client_id,jsonb_build_object('campaign',c.id,'previous_baseline_cents',c.baseline_cents,'started_on',c.started_on));
  perform public.apply_meta_snapshot(c.id,c.observed_cents,c.impressions,c.clicks,c.sampled_at);
 end loop;
end $$;
do $$ declare c public.meta_campaigns;begin for c in select * from public.meta_campaigns order by id for update loop perform public.apply_meta_snapshot(c.id,c.observed_cents,c.impressions,c.clicks,c.sampled_at);end loop;end $$;
commit;
