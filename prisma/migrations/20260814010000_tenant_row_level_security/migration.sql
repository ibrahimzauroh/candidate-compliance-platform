DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'candidate_compliance_app'
  ) THEN
    CREATE ROLE candidate_compliance_app;
  END IF;
END
$$;

ALTER ROLE candidate_compliance_app WITH
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS
  PASSWORD 'candidate_compliance_app_local';

GRANT CONNECT ON DATABASE candidate_compliance TO candidate_compliance_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO candidate_compliance_app;
GRANT USAGE ON TYPE public.tenant_role TO candidate_compliance_app;

GRANT SELECT ON TABLE public.users TO candidate_compliance_app;
GRANT SELECT ON TABLE
  public.tenant_memberships,
  public.candidates,
  public.compliance_documents,
  public.compliance_document_versions
TO candidate_compliance_app;
GRANT INSERT, UPDATE ON TABLE public.candidates TO candidate_compliance_app;

CREATE OR REPLACE FUNCTION public.validate_tenant_membership(
  authenticated_user_id uuid,
  requested_tenant_id uuid
)
RETURNS TABLE (
  membership_id uuid,
  tenant_id uuid,
  user_id uuid,
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
    membership.user_id,
    membership.role
  FROM public.tenant_memberships AS membership
  WHERE membership.user_id = authenticated_user_id
    AND membership.tenant_id = requested_tenant_id
    AND authenticated_user_id IS NOT NULL
    AND requested_tenant_id IS NOT NULL
  LIMIT 1
$function$;

ALTER FUNCTION public.validate_tenant_membership(uuid, uuid)
  OWNER TO candidate_compliance;
REVOKE ALL ON FUNCTION public.validate_tenant_membership(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_tenant_membership(uuid, uuid)
  TO candidate_compliance_app;

ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_memberships_tenant_isolation
  ON public.tenant_memberships
  FOR ALL
  TO candidate_compliance_app
  USING (
    tenant_id = NULLIF(
      pg_catalog.current_setting('app.current_tenant_id', true),
      ''
    )::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(
      pg_catalog.current_setting('app.current_tenant_id', true),
      ''
    )::uuid
  );

ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidates FORCE ROW LEVEL SECURITY;
CREATE POLICY candidates_tenant_isolation
  ON public.candidates
  FOR ALL
  TO candidate_compliance_app
  USING (
    tenant_id = NULLIF(
      pg_catalog.current_setting('app.current_tenant_id', true),
      ''
    )::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(
      pg_catalog.current_setting('app.current_tenant_id', true),
      ''
    )::uuid
  );

ALTER TABLE public.compliance_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY compliance_documents_tenant_isolation
  ON public.compliance_documents
  FOR ALL
  TO candidate_compliance_app
  USING (
    tenant_id = NULLIF(
      pg_catalog.current_setting('app.current_tenant_id', true),
      ''
    )::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(
      pg_catalog.current_setting('app.current_tenant_id', true),
      ''
    )::uuid
  );

ALTER TABLE public.compliance_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_document_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY compliance_document_versions_tenant_isolation
  ON public.compliance_document_versions
  FOR ALL
  TO candidate_compliance_app
  USING (
    tenant_id = NULLIF(
      pg_catalog.current_setting('app.current_tenant_id', true),
      ''
    )::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(
      pg_catalog.current_setting('app.current_tenant_id', true),
      ''
    )::uuid
  );
