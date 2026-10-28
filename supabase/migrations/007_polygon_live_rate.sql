-- Cotação USDT/BRL obtida pelo servidor. Solicitações antigas mantêm os valores originais.
begin;
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
commit;
