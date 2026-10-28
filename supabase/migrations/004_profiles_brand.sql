-- Atualização de perfil, foto privada e logo TechView. Não modifica carteiras.
begin;
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
commit;
