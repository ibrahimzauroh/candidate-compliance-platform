CREATE FUNCTION public.enforce_runtime_cv_extraction_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF CURRENT_USER = 'candidate_compliance_app' THEN
    IF OLD.status <> 'PROPOSED' THEN
      RAISE EXCEPTION 'decided CV extraction proposals are immutable'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status NOT IN ('ACCEPTED', 'REJECTED') THEN
      RAISE EXCEPTION 'invalid CV extraction decision transition'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.enforce_runtime_cv_extraction_transition()
  OWNER TO candidate_compliance;
REVOKE ALL ON FUNCTION public.enforce_runtime_cv_extraction_transition()
  FROM PUBLIC;

CREATE TRIGGER cv_extractions_runtime_transition
BEFORE UPDATE ON public.cv_extractions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_runtime_cv_extraction_transition();

CREATE FUNCTION public.enforce_runtime_candidate_profile_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  source_output jsonb;
BEGIN
  IF CURRENT_USER = 'candidate_compliance_app' THEN
    SELECT extraction.confirmed_output
    INTO source_output
    FROM public.cv_extractions AS extraction
    WHERE extraction.tenant_id = NEW.tenant_id
      AND extraction.candidate_id = NEW.candidate_id
      AND extraction.id = NEW.source_extraction_id
      AND extraction.status = 'ACCEPTED';

    IF NOT FOUND OR source_output IS DISTINCT FROM pg_catalog.jsonb_build_object(
      'fullName', NEW.full_name,
      'skills', NEW.skills,
      'yearsOfExperience', NEW.years_of_experience,
      'certifications', NEW.certifications
    ) THEN
      RAISE EXCEPTION 'candidate profile requires matching accepted extraction evidence'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.enforce_runtime_candidate_profile_source()
  OWNER TO candidate_compliance;
REVOKE ALL ON FUNCTION public.enforce_runtime_candidate_profile_source()
  FROM PUBLIC;

CREATE TRIGGER candidate_profiles_runtime_source
BEFORE INSERT OR UPDATE ON public.candidate_profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_runtime_candidate_profile_source();
