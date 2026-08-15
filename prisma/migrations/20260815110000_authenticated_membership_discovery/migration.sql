CREATE FUNCTION public.list_current_actor_memberships()
RETURNS TABLE (
  membership_id uuid,
  tenant_id uuid,
  tenant_name text,
  role public.tenant_role
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT
    membership.id AS membership_id,
    membership.tenant_id,
    tenant.name AS tenant_name,
    membership.role
  FROM public.tenant_memberships AS membership
  JOIN public.tenants AS tenant
    ON tenant.id = membership.tenant_id
  WHERE membership.user_id = NULLIF(
    pg_catalog.current_setting('app.current_actor_user_id', true),
    ''
  )::uuid
  ORDER BY tenant.name COLLATE "C", membership.tenant_id
$function$;

ALTER FUNCTION public.list_current_actor_memberships()
  OWNER TO candidate_compliance;
REVOKE ALL ON FUNCTION public.list_current_actor_memberships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_current_actor_memberships()
  TO candidate_compliance_app;
