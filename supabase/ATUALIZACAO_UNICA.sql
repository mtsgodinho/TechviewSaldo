-- TECHVIEW SALDO V1.2: ATUALIZAÇÃO ÚNICA PARA O BANCO JÁ EXISTENTE.
-- Inclui integração Meta, conciliação do dia autorizado e taxa de 12%.
-- Ranking/filtros consultam a Meta sem criar débitos e não exigem novas tabelas.
-- Preserve os dados. NÃO cole schema.sql junto com este arquivo.
-- Desative a tradução automática. Copie via Raw no GitHub.
-- Pode ser executado novamente: migrações completas são detectadas e preservadas.
-- A primeira execução pode descontar valores ainda pendentes (gasto + taxa), conforme autorizado.
begin;
do $bundle$
begin
 perform pg_advisory_xact_lock(684321003);
 if to_regclass('public.profiles') is null or to_regclass('public.wallets') is null then
  raise exception 'Banco inicial não encontrado. Este arquivo atualiza um TECHVIEW SALDO já instalado.';
 end if;
 if to_regclass('public.meta_campaigns') is null then
  execute $migration002$
-- Execute uma vez após schema.sql. Não reaplique o schema inicial no banco em uso.
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
$migration002$;
 end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='meta_campaigns' and column_name='charged_tax_cents') then
  execute $migration003$
-- Execute uma vez após 002_meta.sql. Concilia dia de ativação e taxa informada de 12%.
-- Não reaplique schema.sql. A transação inteira é revertida se ocorrer algum erro.
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
$migration003$;
 end if;

 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='avatar_path') then
  execute $migration004$
-- Atualização de perfil, foto privada e logo TechView. Não modifica carteiras.
alter table public.profiles add column avatar_path text,add column phone text not null default '';
alter table public.profiles add constraint own_avatar_path check(avatar_path is null or avatar_path ~ ('^'||id::text||'/[a-f0-9-]{36}\.webp$'));
create table public.brand_settings(id boolean primary key default true check(id),logo_path text check(logo_path is null or logo_path ~ '^brand/[a-f0-9-]{36}\.webp$'),updated_at timestamptz not null default now());
alter table public.brand_settings enable row level security;
create policy brand_public_read on public.brand_settings for select to anon,authenticated using(true);
revoke all on public.brand_settings from anon,authenticated;
grant select on public.brand_settings to anon,authenticated;
grant select on public.brand_settings to service_role;
insert into public.brand_settings(id) values(true);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('techview-profile-media','techview-profile-media',false,4194304,array['image/webp']) on conflict(id) do nothing;
create function public.update_own_profile(p_name text,p_phone text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not is_active() then raise exception 'Acesso não autorizado';end if;
 if length(trim(p_name)) not between 2 and 100 or length(p_phone)>30 then raise exception 'Dados de perfil inválidos';end if;
 update profiles set name=trim(p_name),phone=p_phone where id=auth.uid();
 update clients set phone=p_phone where id=auth.uid();
 insert into audit_logs(actor_id,action,entity_id) values(auth.uid(),'own_profile_updated',auth.uid());
end $$;
create function public.set_own_avatar(p_path text) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare old_path text;begin
 if not is_active() then raise exception 'Acesso não autorizado';end if;
 if p_path is not null and p_path !~ ('^'||auth.uid()::text||'/[a-f0-9-]{36}\.webp$') then raise exception 'Foto inválida';end if;
 select avatar_path into old_path from profiles where id=auth.uid() for update;
 update profiles set avatar_path=p_path where id=auth.uid();
 insert into audit_logs(actor_id,action,entity_id) values(auth.uid(),'own_avatar_updated',auth.uid());return old_path;
end $$;
create function public.set_brand_logo(p_path text) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare old_path text;begin
 perform require_admin();if p_path !~ '^brand/[a-f0-9-]{36}\.webp$' then raise exception 'Logo inválida';end if;
 select logo_path into old_path from brand_settings where id=true for update;
 update brand_settings set logo_path=p_path,updated_at=clock_timestamp() where id=true;
 insert into audit_logs(actor_id,action) values(auth.uid(),'brand_logo_updated');return old_path;
end $$;
revoke execute on function public.update_own_profile(text,text),public.set_own_avatar(text),public.set_brand_logo(text) from public,anon;
grant execute on function public.update_own_profile(text,text),public.set_own_avatar(text),public.set_brand_logo(text) to authenticated;
$migration004$;
 end if;
end $bundle$;
commit;
select 'V1.2: atualização concluída. Carteiras e histórico preservados; integração, perfil, fotos, logo e taxa de 12% habilitados.' as status;
