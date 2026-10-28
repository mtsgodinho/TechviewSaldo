-- Mensalidade via Pix com confirmação manual. Separada da carteira de anúncios.
begin;
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
commit;
