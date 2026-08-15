ALTER TABLE public.candidates
  ADD COLUMN removed_at timestamp(3);

ALTER TABLE public.compliance_documents
  ADD COLUMN removed_at timestamp(3);

CREATE INDEX candidates_tenant_id_removed_at_created_at_id_idx
  ON public.candidates(tenant_id, removed_at, created_at DESC, id);

CREATE INDEX compliance_documents_tenant_id_removed_at_candidate_id_created_at_id_idx
  ON public.compliance_documents(
    tenant_id,
    removed_at,
    candidate_id,
    created_at DESC,
    id
  );

ALTER TABLE public.audit_events
  DROP CONSTRAINT audit_events_action_check;

ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_action_check CHECK (
    action IN (
      'candidate:create',
      'candidate:update',
      'candidate:remove',
      'candidate:read',
      'candidate:list:read',
      'document:create',
      'document:version:create',
      'document:approve',
      'document:correct',
      'document:remove',
      'document:read',
      'document:list:read',
      'document:expiry:read',
      'verification:request',
      'verification:read',
      'verification:pending',
      'verification:verified',
      'verification:failed',
      'ai:extract',
      'ai:read',
      'ai:confirm',
      'ai:reject'
    )
  );

REVOKE UPDATE ON TABLE public.candidates
  FROM candidate_compliance_app;
GRANT UPDATE (
  full_name,
  email,
  role_applied_for,
  removed_at,
  updated_at
) ON TABLE public.candidates TO candidate_compliance_app;

REVOKE UPDATE ON TABLE public.compliance_documents
  FROM candidate_compliance_app;
GRANT UPDATE (
  current_version_id,
  removed_at,
  updated_at
) ON TABLE public.compliance_documents TO candidate_compliance_app;

CREATE FUNCTION public.enforce_runtime_candidate_removal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF CURRENT_USER = 'candidate_compliance_app' THEN
    IF OLD.removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'removed candidates are immutable'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.removed_at IS NOT NULL
      AND (
        NEW.full_name IS DISTINCT FROM OLD.full_name
        OR NEW.email IS DISTINCT FROM OLD.email
        OR NEW.role_applied_for IS DISTINCT FROM OLD.role_applied_for
      )
    THEN
      RAISE EXCEPTION 'candidate removal cannot change active fields'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.enforce_runtime_candidate_removal()
  OWNER TO candidate_compliance;
REVOKE ALL ON FUNCTION public.enforce_runtime_candidate_removal()
  FROM PUBLIC;

CREATE TRIGGER candidates_runtime_removal
BEFORE UPDATE ON public.candidates
FOR EACH ROW
EXECUTE FUNCTION public.enforce_runtime_candidate_removal();

CREATE FUNCTION public.enforce_runtime_document_removal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF CURRENT_USER = 'candidate_compliance_app' THEN
    IF OLD.removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'removed compliance documents are immutable'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.removed_at IS NOT NULL
      AND NEW.current_version_id IS DISTINCT FROM OLD.current_version_id
    THEN
      RAISE EXCEPTION 'document removal cannot change the current version'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.enforce_runtime_document_removal()
  OWNER TO candidate_compliance;
REVOKE ALL ON FUNCTION public.enforce_runtime_document_removal()
  FROM PUBLIC;

CREATE TRIGGER compliance_documents_runtime_removal
BEFORE UPDATE ON public.compliance_documents
FOR EACH ROW
EXECUTE FUNCTION public.enforce_runtime_document_removal();
