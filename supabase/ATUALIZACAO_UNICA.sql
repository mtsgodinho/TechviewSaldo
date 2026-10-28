-- TECHVIEW SALDO V1.3: ATUALIZAÇÃO ÚNICA PARA O BANCO JÁ EXISTENTE.
-- Inclui Meta, conciliação, taxa de 12%, perfil, marca, mensalidade Pix e recargas USDT Polygon.
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

 if to_regclass('public.monthly_settings') is null then
  execute $migration005$
-- Mensalidade via Pix com confirmação manual. Separada da carteira de anúncios.
create table public.monthly_settings(client_id uuid primary key references public.clients(id),amount_cents bigint not null check(amount_cents between 1 and 99999999),updated_at timestamptz not null default clock_timestamp(),updated_by uuid not null references public.profiles(id));
create table public.monthly_requests(
 id uuid primary key default gen_random_uuid(),client_id uuid not null references public.clients(id),amount_cents bigint not null check(amount_cents between 1 and 99999999),
 txid text not null unique check(txid ~ '^[A-Za-z0-9]{1,25}$'),payload text not null,receiver_name text not null,bank text not null,
 status text not null default 'awaiting' check(status in ('awaiting','informed','confirmed','rejected')),created_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),informed_at timestamptz,reviewed_at timestamptz,reviewed_by uuid references public.profiles(id)
);
create unique index monthly_one_pending on public.monthly_requests(client_id) where status in ('awaiting','informed');
create index on public.monthly_requests(client_id,created_at desc);
create table public.monthly_cycles(
 id uuid primary key default gen_random_uuid(),client_id uuid not null references public.clients(id),amount_cents bigint not null check(amount_cents between 1 and 99999999),
 starts_at timestamptz not null,ends_at timestamptz not null check(ends_at>starts_at),activated_by uuid not null references public.profiles(id),request_id uuid not null unique references public.monthly_requests(id)
);
create index on public.monthly_cycles(client_id,starts_at desc);
alter table public.monthly_settings enable row level security;
alter table public.monthly_requests enable row level security;
alter table public.monthly_cycles enable row level security;
create policy monthly_settings_read on public.monthly_settings for select to authenticated using(public.is_admin() or (client_id=auth.uid() and public.is_active()));
create policy monthly_requests_read on public.monthly_requests for select to authenticated using(public.is_admin() or (client_id=auth.uid() and public.is_active()));
create policy monthly_cycles_read on public.monthly_cycles for select to authenticated using(public.is_admin() or (client_id=auth.uid() and public.is_active()));
revoke all on public.monthly_settings,public.monthly_requests,public.monthly_cycles from anon,authenticated;
grant select on public.monthly_settings,public.monthly_requests,public.monthly_cycles to authenticated;
grant select on public.monthly_settings to service_role;
create function public.monthly_period_end(p_start timestamptz) returns timestamptz language sql stable set search_path=pg_catalog as $$
 select ((p_start at time zone 'America/Sao_Paulo')+interval '1 month') at time zone 'America/Sao_Paulo';
$$;
create function public.set_monthly_amount(p_client uuid,p_cents bigint) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform require_admin();if p_cents is null or p_cents<1 or p_cents>99999999 then raise exception 'Informe um valor mensal positivo';end if;
 perform 1 from clients where id=p_client for update;if not found then raise exception 'Cliente não encontrado';end if;
 insert into monthly_settings(client_id,amount_cents,updated_by) values(p_client,p_cents,auth.uid()) on conflict(client_id) do update set amount_cents=excluded.amount_cents,updated_at=clock_timestamp(),updated_by=auth.uid();
 insert into audit_logs(actor_id,action,entity_id,details) values(auth.uid(),'monthly_amount_updated',p_client,jsonb_build_object('amount_cents',p_cents));
end $$;
create function public.create_monthly_request(p_client uuid,p_actor uuid,p_cents bigint,p_txid text,p_payload text,p_receiver text,p_bank text,p_settings_version timestamptz,p_fee_version timestamptz)
returns public.monthly_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare r monthly_requests;s pix_settings;fee monthly_settings;
begin
 if not exists(select 1 from profiles where id=p_actor and active and (role='admin' or id=p_client)) then raise exception 'Acesso não autorizado';end if;
 perform 1 from clients where id=p_client for update;if not found or not exists(select 1 from profiles where id=p_client and active) then raise exception 'Cliente inativo ou inexistente';end if;
 if exists(select 1 from monthly_cycles where client_id=p_client and ends_at>clock_timestamp()) then raise exception 'A mensalidade ainda está ativa. Gere a próxima cobrança após o vencimento';end if;
 select * into r from monthly_requests where client_id=p_client and status in ('awaiting','informed');if found then return r;end if;
 select * into fee from monthly_settings where client_id=p_client;
 select * into s from pix_settings where id=true for share;
 if fee.client_id is null or s.id is null or fee.amount_cents<>p_cents or fee.updated_at<>p_fee_version or s.updated_at<>p_settings_version then raise exception 'Configuração alterada. Gere o Pix novamente';end if;
 insert into monthly_requests(client_id,amount_cents,txid,payload,receiver_name,bank,created_by) values(p_client,p_cents,p_txid,p_payload,s.receiver_name,s.bank,p_actor) returning * into r;
 insert into audit_logs(actor_id,action,entity_id,details) values(p_actor,'monthly_pix_created',p_client,jsonb_build_object('request_id',r.id,'amount_cents',r.amount_cents));return r;
end $$;
create function public.inform_monthly_payment(p_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin if not is_active() then raise exception 'Acesso não autorizado';end if;
 update monthly_requests set status='informed',informed_at=now() where id=p_id and client_id=auth.uid() and status='awaiting';
end $$;
create function public.review_monthly_payment(p_id uuid,p_confirm boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r monthly_requests;started timestamptz;
begin
 perform require_admin();select * into r from monthly_requests where id=p_id;if not found then raise exception 'Cobrança não encontrada';end if;
 perform 1 from clients where id=r.client_id for update;
 select * into r from monthly_requests where id=p_id for update;
 if r.status in ('confirmed','rejected') then return;end if;
 if p_confirm then
  started=clock_timestamp();
  if not exists(select 1 from profiles where id=r.client_id and active) then raise exception 'Cliente inativo';end if;
  if exists(select 1 from monthly_cycles where client_id=r.client_id and ends_at>started) then raise exception 'O cliente já tem mensalidade ativa';end if;
  insert into monthly_cycles(client_id,amount_cents,starts_at,ends_at,activated_by,request_id) values(r.client_id,r.amount_cents,started,monthly_period_end(started),auth.uid(),r.id);
 end if;
 update monthly_requests set status=case when p_confirm then 'confirmed' else 'rejected' end,reviewed_at=case when p_confirm then started else clock_timestamp() end,reviewed_by=auth.uid() where id=p_id;
 insert into audit_logs(actor_id,action,entity_id,details) values(auth.uid(),case when p_confirm then 'monthly_payment_confirmed' else 'monthly_payment_rejected' end,r.client_id,jsonb_build_object('request_id',r.id,'amount_cents',r.amount_cents));
end $$;
revoke execute on function public.monthly_period_end(timestamptz),public.set_monthly_amount(uuid,bigint),public.create_monthly_request(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz),public.inform_monthly_payment(uuid),public.review_monthly_payment(uuid,boolean) from public,anon;
revoke execute on function public.create_monthly_request(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz) from authenticated;
grant execute on function public.set_monthly_amount(uuid,bigint),public.inform_monthly_payment(uuid),public.review_monthly_payment(uuid,boolean) to authenticated;
grant execute on function public.create_monthly_request(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz) to service_role;
$migration005$;
 end if;
 if to_regclass('public.polygon_settings') is null then
 execute $migration006$
-- USDT na Polygon PoS (137), cotação manual e crédito somente após conferência administrativa.
create table public.polygon_settings(
 id boolean primary key default true check(id),enabled boolean not null default false,
 recipient_address text not null check(recipient_address ~ '^0x[0-9a-fA-F]{40}$' and lower(recipient_address)<>'0x0000000000000000000000000000000000000000'),
 rate_micro_brl bigint not null check(rate_micro_brl between 1 and 999999999999),minimum_cents bigint not null check(minimum_cents between 1 and 99999999),updated_at timestamptz not null default clock_timestamp()
);
create table public.polygon_requests(
 id uuid primary key default gen_random_uuid(),client_id uuid not null references public.clients(id),created_by uuid not null references public.profiles(id),
 amount_cents bigint not null check(amount_cents between 1 and 99999999),rate_micro_brl bigint not null check(rate_micro_brl between 1 and 999999999999),
 recipient_address text not null check(recipient_address ~ '^0x[0-9a-fA-F]{40}$' and lower(recipient_address)<>'0x0000000000000000000000000000000000000000'),
 amount_units text not null check(amount_units ~ '^[1-9][0-9]{0,77}$'),network_id integer not null default 137 check(network_id=137),token text not null default 'USDT' check(token='USDT'),
 status text not null default 'awaiting' check(status in ('awaiting','informed','confirmed','rejected','cancelled')),
 tx_hash text check(tx_hash ~ '^0x[0-9a-f]{64}$' and tx_hash<>'0x'||repeat('0',64)),
 created_at timestamptz not null default now(),informed_at timestamptz,reviewed_at timestamptz,reviewed_by uuid references public.profiles(id),
 check(status not in ('informed','confirmed') or (tx_hash is not null and informed_at is not null)),
 check(status<>'confirmed' or (reviewed_at is not null and reviewed_by is not null))
);
create unique index polygon_one_pending on public.polygon_requests(client_id) where status in ('awaiting','informed');
create unique index polygon_hash_credited_once on public.polygon_requests(tx_hash) where status='confirmed';
create index on public.polygon_requests(client_id,created_at desc);
alter table public.wallet_transactions add column polygon_request_id uuid unique references public.polygon_requests(id);
alter table public.polygon_settings enable row level security;
alter table public.polygon_requests enable row level security;
create policy polygon_settings_read on public.polygon_settings for select to authenticated using(public.is_active());
create policy polygon_requests_read on public.polygon_requests for select to authenticated using(public.is_admin() or (client_id=auth.uid() and public.is_active()));
revoke all on public.polygon_settings,public.polygon_requests from anon,authenticated;
grant select on public.polygon_settings,public.polygon_requests to authenticated;
create function public.save_polygon_settings(p_address text,p_rate bigint,p_minimum bigint,p_enabled boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform require_admin();
 if p_address is null or p_address!~'^0x[0-9a-fA-F]{40}$' or lower(p_address)='0x0000000000000000000000000000000000000000' or p_rate is null or p_rate not between 1 and 999999999999 or p_minimum is null or p_minimum not between 1 and 99999999 or p_enabled is null then raise exception 'Endereço, cotação ou mínimo inválido';end if;
 insert into polygon_settings(id,recipient_address,rate_micro_brl,minimum_cents,enabled) values(true,p_address,p_rate,p_minimum,p_enabled) on conflict(id) do update set recipient_address=excluded.recipient_address,rate_micro_brl=excluded.rate_micro_brl,minimum_cents=excluded.minimum_cents,enabled=excluded.enabled,updated_at=clock_timestamp();
 insert into audit_logs(actor_id,action,details) values(auth.uid(),'polygon_settings_updated',jsonb_build_object('recipient_address',p_address,'rate_micro_brl',p_rate,'minimum_cents',p_minimum,'enabled',p_enabled));
end $$;
create function public.create_polygon_request(p_client uuid,p_cents bigint) returns public.polygon_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare r polygon_requests;s polygon_settings;
begin
 if not is_active() or (not is_admin() and auth.uid()<>p_client) then raise exception 'Acesso não autorizado';end if;
 perform 1 from clients where id=p_client for update;
 if not found or not exists(select 1 from profiles where id=p_client and active and role='client') then raise exception 'Cliente inativo ou inexistente';end if;
 if p_cents is null or p_cents not between 1 and 99999999 then raise exception 'Valor de recarga inválido';end if;
 select * into r from polygon_requests where client_id=p_client and status in ('awaiting','informed');if found then return r;end if;
 select * into s from polygon_settings where id=true for share;
 if s.id is null or not s.enabled then raise exception 'Recebimento por USDT ainda não está habilitado';end if;
 if p_cents<s.minimum_cents then raise exception 'O valor é menor que o mínimo de recarga USDT';end if;
 insert into polygon_requests(client_id,created_by,amount_cents,rate_micro_brl,recipient_address,amount_units)
 values(p_client,auth.uid(),p_cents,s.rate_micro_brl,s.recipient_address,ceil((p_cents::numeric*10000000000)/s.rate_micro_brl)::numeric(78,0)::text) returning * into r;
 insert into audit_logs(actor_id,action,entity_id,details) values(auth.uid(),'polygon_request_created',p_client,jsonb_build_object('request_id',r.id,'amount_cents',r.amount_cents,'amount_units',r.amount_units,'rate_micro_brl',r.rate_micro_brl,'recipient_address',r.recipient_address));return r;
end $$;
create function public.inform_polygon_payment(p_id uuid,p_hash text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r polygon_requests;
begin
 if not is_active() then raise exception 'Acesso não autorizado';end if;
 select * into r from polygon_requests where id=p_id and client_id=auth.uid() for update;if not found then raise exception 'Solicitação não encontrada';end if;
 if p_hash is null or lower(p_hash)!~'^0x[0-9a-f]{64}$' or lower(p_hash)='0x'||repeat('0',64) then raise exception 'ID da transação inválido';end if;
 if r.status='informed' and r.tx_hash=lower(p_hash) then return;end if;
 if r.status<>'awaiting' then raise exception 'Solicitação já analisada ou informada. Solicite a correção ao administrador';end if;
 update polygon_requests set status='informed',tx_hash=lower(p_hash),informed_at=clock_timestamp() where id=p_id;
 insert into audit_logs(actor_id,action,entity_id,details) values(auth.uid(),'polygon_payment_informed',r.client_id,jsonb_build_object('request_id',r.id,'tx_hash',lower(p_hash)));
end $$;
create function public.cancel_polygon_request(p_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not is_active() then raise exception 'Acesso não autorizado';end if;
 update polygon_requests set status='cancelled' where id=p_id and client_id=auth.uid() and status='awaiting';if not found then raise exception 'Somente solicitações próprias sem transferência informada podem ser canceladas';end if;
 insert into audit_logs(actor_id,action,entity_id,details) values(auth.uid(),'polygon_request_cancelled',auth.uid(),jsonb_build_object('request_id',p_id));
end $$;
create function public.review_polygon_payment(p_id uuid,p_confirm boolean,p_expected_hash text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r polygon_requests;b bigint;
begin
 perform require_admin();if p_confirm is null then raise exception 'Decisão inválida';end if;
 select * into r from polygon_requests where id=p_id;if not found then raise exception 'Solicitação não encontrada';end if;
 perform 1 from clients where id=r.client_id for update;
 select balance_cents into b from wallets where client_id=r.client_id for update;if not found then raise exception 'Carteira não encontrada';end if;
 select * into r from polygon_requests where id=p_id for update;
 if r.status in ('confirmed','rejected','cancelled') then return;end if;
 if p_confirm then
  if r.status<>'informed' or r.tx_hash is null or p_expected_hash is null or r.tx_hash<>lower(p_expected_hash) then raise exception 'Confira novamente o hash informado antes de confirmar';end if;
  if exists(select 1 from polygon_requests where tx_hash=r.tx_hash and status='confirmed' and id<>r.id) then raise exception 'Esta transferência já foi creditada em outra solicitação';end if;
  update wallets set balance_cents=balance_cents+r.amount_cents where client_id=r.client_id;
  insert into wallet_transactions(client_id,type,amount_cents,description,balance_before,balance_after,actor_id,operation_id,polygon_request_id)
  values(r.client_id,'manual_credit',r.amount_cents,'Recarga USDT (Polygon) - '||r.id,b,b+r.amount_cents,auth.uid(),r.id,r.id);
 end if;
 update polygon_requests set status=case when p_confirm then 'confirmed' else 'rejected' end,reviewed_at=clock_timestamp(),reviewed_by=auth.uid() where id=p_id;
 insert into audit_logs(actor_id,action,entity_id,details) values(auth.uid(),case when p_confirm then 'polygon_payment_confirmed' else 'polygon_payment_rejected' end,r.client_id,jsonb_build_object('request_id',r.id,'amount_cents',r.amount_cents,'amount_units',r.amount_units,'tx_hash',r.tx_hash,'rate_micro_brl',r.rate_micro_brl));
exception when unique_violation then raise exception 'Transferência ou solicitação já creditada. Nenhum novo crédito foi lançado';
end $$;
revoke execute on function public.save_polygon_settings(text,bigint,bigint,boolean),public.create_polygon_request(uuid,bigint),public.inform_polygon_payment(uuid,text),public.cancel_polygon_request(uuid),public.review_polygon_payment(uuid,boolean,text) from public,anon;
grant execute on function public.save_polygon_settings(text,bigint,bigint,boolean),public.create_polygon_request(uuid,bigint),public.inform_polygon_payment(uuid,text),public.cancel_polygon_request(uuid),public.review_polygon_payment(uuid,boolean,text) to authenticated;
$migration006$;
 end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='polygon_requests' and column_name='rate_source') then
 execute $migration007$
alter table public.polygon_settings alter column rate_micro_brl drop not null;
alter table public.polygon_requests add column rate_source text,add column rate_quoted_at timestamptz;
create function public.configure_polygon_receiving(p_address text,p_minimum bigint,p_enabled boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform require_admin();
 if p_address is null or p_address!~'^0x[0-9a-fA-F]{40}$' or lower(p_address)='0x0000000000000000000000000000000000000000' or p_minimum is null or p_minimum not between 1 and 99999999 or p_enabled is null then raise exception 'Endereço ou mínimo inválido';end if;
 insert into polygon_settings(id,recipient_address,minimum_cents,enabled) values(true,p_address,p_minimum,p_enabled) on conflict(id) do update set recipient_address=excluded.recipient_address,minimum_cents=excluded.minimum_cents,enabled=excluded.enabled,updated_at=clock_timestamp();
 insert into audit_logs(actor_id,action,details) values(auth.uid(),'polygon_settings_updated',jsonb_build_object('recipient_address',p_address,'minimum_cents',p_minimum,'enabled',p_enabled,'rate_mode','automatic'));
end $$;
create function public.create_polygon_request_at_rate(p_actor uuid,p_client uuid,p_cents bigint,p_rate bigint,p_quoted_at timestamptz,p_source text) returns public.polygon_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare r polygon_requests;s polygon_settings;
begin
 if not exists(select 1 from profiles where id=p_actor and active and (role='admin' or (role='client' and id=p_client))) then raise exception 'Acesso não autorizado';end if;
 perform 1 from clients where id=p_client for update;
 if not found or not exists(select 1 from profiles where id=p_client and active and role='client') then raise exception 'Cliente inativo ou inexistente';end if;
 if p_cents is null or p_cents not between 1 and 99999999 then raise exception 'Valor de recarga inválido';end if;
 select * into r from polygon_requests where client_id=p_client and status in ('awaiting','informed');if found then return r;end if;
 if p_rate is null or p_rate not between 1 and 999999999999 or p_quoted_at is null or p_quoted_at<clock_timestamp()-interval '10 minutes' or p_quoted_at>clock_timestamp()+interval '15 seconds' or p_source is distinct from 'AwesomeAPI USD/BRL' then raise exception 'Cotação inválida ou desatualizada';end if;
 select * into s from polygon_settings where id=true for share;
 if s.id is null or not s.enabled then raise exception 'Recebimento por USDT ainda não está habilitado';end if;
 if p_cents<s.minimum_cents then raise exception 'O valor é menor que o mínimo de recarga USDT';end if;
 insert into polygon_requests(client_id,created_by,amount_cents,rate_micro_brl,recipient_address,amount_units,rate_source,rate_quoted_at)
 values(p_client,p_actor,p_cents,p_rate,s.recipient_address,ceil((p_cents::numeric*10000000000)/p_rate)::numeric(78,0)::text,p_source,p_quoted_at) returning * into r;
 insert into audit_logs(actor_id,action,entity_id,details) values(p_actor,'polygon_request_created',p_client,jsonb_build_object('request_id',r.id,'amount_cents',r.amount_cents,'amount_units',r.amount_units,'rate_micro_brl',r.rate_micro_brl,'recipient_address',r.recipient_address,'rate_source',r.rate_source,'rate_quoted_at',r.rate_quoted_at));return r;
end $$;
-- O navegador não pode fornecer a cotação nem continuar criando solicitações pela função manual antiga.
revoke execute on function public.create_polygon_request(uuid,bigint) from public,anon,authenticated;
revoke execute on function public.configure_polygon_receiving(text,bigint,boolean) from public,anon;
grant execute on function public.configure_polygon_receiving(text,bigint,boolean) to authenticated;
revoke execute on function public.create_polygon_request_at_rate(uuid,uuid,bigint,bigint,timestamptz,text) from public,anon,authenticated;
grant execute on function public.create_polygon_request_at_rate(uuid,uuid,bigint,bigint,timestamptz,text) to service_role;
$migration007$;
 end if;
end $bundle$;
commit;
select 'V1.3: atualização concluída. Carteiras e histórico preservados; integração, mensalidade, perfil, fotos, logo, USDT Polygon com cotação automática e taxa de 12% habilitados.' as status;
