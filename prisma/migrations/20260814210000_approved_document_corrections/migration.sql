ALTER TABLE public.audit_events
  DROP CONSTRAINT audit_events_action_check;

ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_action_check CHECK (
    action IN (
      'candidate:create',
      'candidate:update',
      'candidate:read',
      'candidate:list:read',
      'document:create',
      'document:version:create',
      'document:approve',
      'document:correct',
      'document:read',
      'document:list:read',
      'document:expiry:read'
    )
  );

REVOKE UPDATE ON TABLE public.compliance_document_versions
  FROM candidate_compliance_app;
GRANT UPDATE (status) ON TABLE public.compliance_document_versions
  TO candidate_compliance_app;

CREATE FUNCTION public.enforce_runtime_document_version_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF CURRENT_USER = 'candidate_compliance_app' THEN
    IF OLD.status = 'APPROVED' THEN
      RAISE EXCEPTION 'approved compliance document versions are immutable'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
      AND NOT (
        OLD.status IN ('DRAFT', 'PENDING_REVIEW')
        AND NEW.status = 'APPROVED'
      ) THEN
      RAISE EXCEPTION 'invalid compliance document version transition'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.enforce_runtime_document_version_transition()
  OWNER TO candidate_compliance;
REVOKE ALL ON FUNCTION public.enforce_runtime_document_version_transition()
  FROM PUBLIC;

CREATE TRIGGER compliance_document_versions_runtime_transition
BEFORE UPDATE ON public.compliance_document_versions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_runtime_document_version_transition();
