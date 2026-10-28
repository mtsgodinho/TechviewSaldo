-- USDT na Polygon PoS (137), cotação manual e crédito somente após conferência administrativa.
begin;
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
commit;
