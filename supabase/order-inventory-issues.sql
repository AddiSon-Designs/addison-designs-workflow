-- Applied through issue_order_stock_once; order-scoped, transactional inventory usage.

create table public.shop_inventory_issues(
 organization_id uuid not null references public.organizations(id) on delete cascade,
 order_id uuid not null,
 receipt jsonb not null,
 created_at timestamptz not null default now(),
 primary key(organization_id,order_id)
);
alter table public.shop_inventory_issues enable row level security;
create policy "Members read inventory issues" on public.shop_inventory_issues for select to authenticated using(public.is_org_member(organization_id));
create policy "Admins create inventory issues" on public.shop_inventory_issues for insert to authenticated with check(public.is_org_admin(organization_id));
grant select,insert on public.shop_inventory_issues to authenticated;
create or replace function public.shop_inventory_key(p_category text,p_brand text,p_model text,p_color text,p_size text) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
select jsonb_build_array(p_category,
 lower(regexp_replace(btrim(coalesce(p_brand,'')),'\s+',' ','g')),
 lower(regexp_replace(btrim(coalesce(p_model,'')),'\s+',' ','g')),
 lower(regexp_replace(btrim(coalesce(p_color,'')),'\s+',' ','g')),
 case lower(regexp_replace(btrim(coalesce(p_size,'')),'[\s-]','','g')) when 'xxl' then '2xl' when 'xxxl' then '3xl' when 'xxxxl' then '4xl' when 'onesize' then 'os' else lower(regexp_replace(btrim(coalesce(p_size,'')),'[\s-]','','g')) end);
$$;
revoke all on function public.shop_inventory_key(text,text,text,text,text) from public,anon;
grant execute on function public.shop_inventory_key(text,text,text,text,text) to authenticated;
create or replace function public.apply_order_inventory(p_order_id uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 org uuid; prior jsonb; job record; entry jsonb; item jsonb; lines jsonb; issues jsonb;
 stock record; remaining integer; needed integer; used integer; take integer; key jsonb; category text;
 jobs_receipt jsonb:='{}'; receipt jsonb; used_total integer:=0; expected integer; actual integer;
begin
 if auth.uid() is null then raise exception 'Sign in before using inventory'; end if;
 select organization_id into org from public.jobs where source_job_id is null and custom_fields#>>'{addisonOrder,orderId}'=p_order_id::text limit 1;
 if org is null or not public.is_org_admin(org) then raise exception 'This order is not available for inventory allocation'; end if;
 perform pg_advisory_xact_lock(hashtextextended('shop-inventory:'||org::text,0));
 select i.receipt into prior from public.shop_inventory_issues i where organization_id=org and order_id=p_order_id;
 if prior is not null then return prior; end if;
 select count(*) into actual from public.jobs where organization_id=org and source_job_id is null and custom_fields#>>'{addisonOrder,orderId}'=p_order_id::text;
 select (custom_fields#>>'{addisonOrder,itemCount}')::integer into expected from public.jobs where organization_id=org and source_job_id is null and custom_fields#>>'{addisonOrder,orderId}'=p_order_id::text limit 1;
 if actual<>expected then raise exception 'All order items must be saved before inventory is used'; end if;
 for job in select * from public.jobs where organization_id=org and source_job_id is null and custom_fields#>>'{addisonOrder,orderId}'=p_order_id::text order by (custom_fields#>>'{addisonOrder,position}')::integer,id for update loop
  item:=job.custom_fields#>'{addisonOrder,item}';
  if item->>'useInventory' is distinct from 'true' or item->>'kind' not in ('apparel','cap') then continue; end if;
  category:=case item->>'kind' when 'cap' then 'caps' else 'apparel' end;
  if category='apparel' then
   select coalesce(jsonb_agg(jsonb_build_object('color',item->>'color','size',v->>'size','quantity',v->'quantity')),'[]') into lines from jsonb_array_elements(coalesce(item->'sizes','[]')) v;
  else
   if jsonb_array_length(coalesce(item->'colors','[]'))>0 then
    select jsonb_agg(jsonb_build_object('color',v->>'color','size',item->>'capSize','quantity',v->'quantity')) into lines from jsonb_array_elements(item->'colors') v;
   else lines:=jsonb_build_array(jsonb_build_object('color',item->>'color','size',item->>'capSize','quantity',item->'quantity')); end if;
  end if;
  issues:='[]';
  for entry in select value from jsonb_array_elements(lines) loop
   needed:=coalesce((entry->>'quantity')::integer,0);if needed<=0 then continue; end if;
   if coalesce(btrim(item->>'manufacturer'),'')='' or coalesce(btrim(item->>'model'),'')='' or coalesce(btrim(entry->>'color'),'')='' or coalesce(btrim(entry->>'size'),'')='' then raise exception 'Choose brand, model, color and size before using inventory'; end if;
   key:=public.shop_inventory_key(category,item->>'manufacturer',item->>'model',entry->>'color',entry->>'size');
   remaining:=needed;used:=0;
   for stock in select * from public.shop_inventory inv where inv.organization_id=org and inv.quantity>0 and public.shop_inventory_key(inv.category,inv.brand,inv.model,inv.color,inv.size)=key order by inv.id for update loop
    take:=least(remaining,stock.quantity);if take<=0 then exit; end if;
    update public.shop_inventory set quantity=quantity-take,updated_at=now() where id=stock.id and organization_id=org;
    remaining:=remaining-take;used:=used+take;if remaining=0 then exit; end if;
   end loop;
   used_total:=used_total+used;
   issues:=issues||jsonb_build_array(jsonb_build_object('key',key,'brand',item->>'manufacturer','model',item->>'model','color',entry->>'color','size',entry->>'size','quantity',needed,'use',used,'toOrder',remaining));
  end loop;
  item:=jsonb_set(item,'{inventoryIssue}',jsonb_build_object('orderId',p_order_id,'lines',issues,'appliedAt',now()));
  update public.jobs set custom_fields=jsonb_set(custom_fields,'{addisonOrder,item}',item),updated_by=auth.uid() where id=job.id;
  jobs_receipt:=jsonb_set(jobs_receipt,array[job.id::text],item->'inventoryIssue');
 end loop;
 receipt:=jsonb_build_object('orderId',p_order_id,'jobs',jobs_receipt,'usedTotal',used_total);
 insert into public.shop_inventory_issues(organization_id,order_id,receipt) values(org,p_order_id,receipt);
 return receipt;
end $$;
revoke all on function public.apply_order_inventory(uuid) from public,anon;
grant execute on function public.apply_order_inventory(uuid) to authenticated;
