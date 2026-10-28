-- Aviso de saldo negativo (Evolution) e pausa por carteira <= -R$ 20,00.
begin;
alter table public.clients add column whatsapp_opt_in boolean not null default false;
alter table public.meta_campaigns add column auto_pause_confirmed_at timestamptz,add column auto_pause_checked_at timestamptz,add column auto_pause_error text;
create table public.balance_controls(
 client_id uuid primary key references public.clients(id),balance_cents bigint not null default 0,negative_episode uuid,
 alert_status text not null default 'idle' check(alert_status in ('idle','pending','sending','sent','failed','unknown')),
 alert_started_at timestamptz,alert_message_id text,alert_error text,
 processing_id uuid,processing_until timestamptz,updated_at timestamptz not null default clock_timestamp()
);
alter table public.balance_controls enable row level security;
create policy balance_controls_read on public.balance_controls for select to authenticated using(is_admin() or (client_id=auth.uid() and is_active()));
revoke all on public.balance_controls from anon,authenticated;grant select on public.balance_controls to authenticated;
grant select,update,insert on public.balance_controls to service_role;
create function public.client_net_balance(p_client uuid) returns bigint language sql security definer set search_path=public,pg_temp as $$
 select (w.balance_cents-coalesce((select sum(greatest(0,(c.observed_cents-c.baseline_cents)::numeric+floor(((c.observed_cents-c.baseline_cents)::numeric*12+50)/100)-c.charged_cents)) from meta_campaigns c where c.client_id=w.client_id),0))::bigint from wallets w where w.client_id=p_client
$$;
create function public.set_whatsapp_opt_in(p_client uuid,p_enabled boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not is_active() or (not is_admin() and auth.uid()<>p_client) or p_enabled is null then raise exception 'Acesso não autorizado';end if;
 update clients set whatsapp_opt_in=p_enabled where id=p_client;if not found then raise exception 'Cliente não encontrado';end if;
 insert into audit_logs(actor_id,action,entity_id,details) values(auth.uid(),'whatsapp_consent_updated',p_client,jsonb_build_object('enabled',p_enabled));
end $$;
create function public.claim_balance_control(p_client uuid,p_send_enabled boolean) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r balance_controls;b bigint;send_now boolean:=false;client_name text;client_phone text;can_notify boolean;
begin
 perform 1 from clients where id=p_client for update;if not found then return null;end if;
 select client_net_balance(p_client) into b;if b is null then return null;end if;
 insert into balance_controls(client_id) values(p_client) on conflict do nothing;
 select * into r from balance_controls where client_id=p_client for update;
 if r.processing_until>clock_timestamp() then return null;end if;
 select p.name,c.phone,(p.active and c.whatsapp_opt_in) into client_name,client_phone,can_notify from clients c join profiles p on p.id=c.id where c.id=p_client;
 if b>=0 then r.negative_episode:=null;r.alert_status:='idle';r.alert_error:=null;r.alert_message_id:=null;r.alert_started_at:=null;
 elsif r.negative_episode is null then r.negative_episode:=gen_random_uuid();r.alert_status:='pending';r.alert_error:=null;r.alert_message_id:=null;r.alert_started_at:=null;
 elsif r.alert_status='sending' and r.alert_started_at<clock_timestamp()-interval '2 minutes' then r.alert_status:='unknown';r.alert_error:='Envio sem resposta final. Confira a Evolution antes de qualquer reenvio manual.';
 end if;
 if b<0 and p_send_enabled and can_notify and (r.alert_status='pending' or (r.alert_status='failed' and r.alert_started_at<clock_timestamp()-interval '10 minutes')) then
  send_now:=true;r.alert_status:='sending';r.alert_started_at:=clock_timestamp();r.alert_error:=null;
 end if;
 r.processing_id:=gen_random_uuid();r.processing_until:=clock_timestamp()+interval '90 seconds';
 update balance_controls set balance_cents=b,negative_episode=r.negative_episode,alert_status=r.alert_status,alert_started_at=r.alert_started_at,alert_message_id=r.alert_message_id,alert_error=r.alert_error,processing_id=r.processing_id,processing_until=r.processing_until,updated_at=clock_timestamp() where client_id=p_client;
 return jsonb_build_object('client_id',p_client,'balance_cents',b,'negative_episode',r.negative_episode,'processing_id',r.processing_id,'send_alert',send_now,'needs_pause',b<=-2000,'name',client_name,'phone',client_phone);
end $$;
create function public.finish_balance_alert(p_client uuid,p_processing uuid,p_episode uuid,p_status text,p_message_id text,p_error text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_status not in ('sent','failed','unknown') then raise exception 'Resultado inválido';end if;
 update balance_controls set alert_status=p_status,alert_message_id=p_message_id,alert_error=left(p_error,500),updated_at=clock_timestamp() where client_id=p_client and processing_id=p_processing and negative_episode=p_episode and alert_status='sending';
end $$;
create function public.release_balance_control(p_client uuid,p_processing uuid) returns void language sql security definer set search_path=public,pg_temp as $$
 update balance_controls set processing_id=null,processing_until=null where client_id=p_client and processing_id=p_processing
$$;
create function public.record_auto_pause(p_campaign text,p_confirmed boolean,p_error text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c meta_campaigns;
begin
 select * into c from meta_campaigns where id=p_campaign for update;if not found or p_confirmed is null then raise exception 'Campanha não encontrada';end if;
 update meta_campaigns set auto_pause_checked_at=clock_timestamp(),auto_pause_confirmed_at=case when p_confirmed then clock_timestamp() else auto_pause_confirmed_at end,auto_pause_error=case when p_confirmed then null else left(p_error,500) end where id=p_campaign;
 if (p_confirmed and (c.auto_pause_confirmed_at is null or c.auto_pause_error is not null)) or (not p_confirmed and c.auto_pause_error is distinct from p_error) then
  insert into audit_logs(actor_id,action,entity_id,details) values(c.bound_by,case when p_confirmed then 'meta_auto_pause_confirmed' else 'meta_auto_pause_failed' end,c.client_id,jsonb_build_object('campaign_id',c.id,'source','balance_automation','limit_cents',-2000,'error',case when p_confirmed then null else left(p_error,500) end));
 end if;
end $$;
revoke execute on function public.record_auto_pause(text,boolean,text) from public,anon,authenticated;
grant execute on function public.record_auto_pause(text,boolean,text) to service_role;
revoke execute on function public.client_net_balance(uuid),public.claim_balance_control(uuid,boolean),public.finish_balance_alert(uuid,uuid,uuid,text,text,text),public.release_balance_control(uuid,uuid) from public,anon,authenticated;
grant execute on function public.client_net_balance(uuid),public.claim_balance_control(uuid,boolean),public.finish_balance_alert(uuid,uuid,uuid,text,text,text),public.release_balance_control(uuid,uuid) to service_role;
revoke execute on function public.set_whatsapp_opt_in(uuid,boolean) from public,anon;grant execute on function public.set_whatsapp_opt_in(uuid,boolean) to authenticated;
commit;
