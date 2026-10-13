-- Shared, sequential AddiSon Designs invoice numbering.
-- Run once in the Supabase SQL Editor.
create table if not exists public.invoice_number_counters (
  organization_id uuid not null,
  invoice_year integer not null,
  last_number integer not null default 0,
  primary key (organization_id, invoice_year)
);

create table if not exists public.invoice_number_allocations (
  organization_id uuid not null,
  order_id uuid not null,
  invoice_year integer not null,
  invoice_number text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, order_id),
  unique (organization_id, invoice_number)
);

alter table public.invoice_number_counters enable row level security;
alter table public.invoice_number_allocations enable row level security;
revoke all on table public.invoice_number_counters from public, anon, authenticated;
revoke all on table public.invoice_number_allocations from public, anon, authenticated;

create or replace function public.next_invoice_number(
  p_organization_id uuid,
  p_year integer,
  p_order_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_member_organization uuid;
  v_existing text;
  v_next integer;
  v_number text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select p.organization_id
    into v_member_organization
    from public.profiles as p
   where p.user_id = auth.uid();

  if v_member_organization is distinct from p_organization_id then
    raise exception 'You are not a member of this organization';
  end if;

  if p_year < 2000 or p_year > 9999 then
    raise exception 'Invalid invoice year';
  end if;

  select a.invoice_number
    into v_existing
    from public.invoice_number_allocations as a
   where a.organization_id = p_organization_id
     and a.order_id = p_order_id;

  if found then
    return v_existing;
  end if;

  begin
    insert into public.invoice_number_counters (organization_id, invoice_year, last_number)
    values (p_organization_id, p_year, 1)
    on conflict (organization_id, invoice_year)
    do update
       set last_number = public.invoice_number_counters.last_number + 1
    returning last_number into v_next;

    v_number := 'AD'
      || pg_catalog.right(p_year::text, 2)
      || '-'
      || case
           when v_next < 10000 then pg_catalog.lpad(v_next::text, 4, '0')
           else v_next::text
         end;

    insert into public.invoice_number_allocations
      (organization_id, order_id, invoice_year, invoice_number)
    values
      (p_organization_id, p_order_id, p_year, v_number);

    return v_number;
  exception when unique_violation then
    -- Concurrent attempts for the same order return its already allocated number.
    select a.invoice_number
      into v_existing
      from public.invoice_number_allocations as a
     where a.organization_id = p_organization_id
       and a.order_id = p_order_id;

    if found then
      return v_existing;
    end if;

    raise;
  end;
end;
$function$;

revoke all on function public.next_invoice_number(uuid, integer, uuid) from public, anon;
grant execute on function public.next_invoice_number(uuid, integer, uuid) to authenticated;
