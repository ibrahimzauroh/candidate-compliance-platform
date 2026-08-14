DROP FUNCTION public.claim_next_verification_outbox_event(text);

CREATE FUNCTION public.claim_next_verification_outbox_event(
  worker_identifier text
)
RETURNS TABLE (
  outbox_event_id uuid,
  tenant_id uuid,
  verification_request_id uuid,
  attempt_count integer,
  max_attempts integer,
  attempts_exhausted boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9._:-]{1,100}$'
  THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH next_event AS (
    SELECT
      event.id,
      event.attempts,
      event.max_attempts
    FROM public.outbox_events AS event
    WHERE event.type = 'RIGHT_TO_WORK_VERIFICATION_REQUESTED'
      AND event.processed_at IS NULL
      AND event.available_at <= pg_catalog.clock_timestamp()
      AND (
        event.locked_until IS NULL
        OR event.locked_until <= pg_catalog.clock_timestamp()
      )
    ORDER BY event.available_at, event.created_at, event.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.outbox_events AS event
    SET
      attempts = LEAST(event.attempts + 1, event.max_attempts),
      locked_at = pg_catalog.clock_timestamp(),
      locked_until = pg_catalog.clock_timestamp() + interval '30 seconds',
      locked_by = worker_identifier
    FROM next_event
    WHERE event.id = next_event.id
    RETURNING
      event.id,
      event.tenant_id,
      event.verification_request_id,
      event.attempts,
      event.max_attempts,
      next_event.attempts >= next_event.max_attempts AS attempts_exhausted
  )
  SELECT
    claimed.id,
    claimed.tenant_id,
    claimed.verification_request_id,
    claimed.attempts,
    claimed.max_attempts,
    claimed.attempts_exhausted
  FROM claimed;
END
$function$;

ALTER FUNCTION public.claim_next_verification_outbox_event(text)
  OWNER TO candidate_compliance;
REVOKE ALL ON FUNCTION public.claim_next_verification_outbox_event(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_verification_outbox_event(text)
  TO candidate_compliance_app;
