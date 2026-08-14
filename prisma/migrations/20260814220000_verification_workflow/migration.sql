-- CreateEnum
CREATE TYPE "verification_status" AS ENUM ('REQUESTED', 'PENDING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "outbox_event_type" AS ENUM ('RIGHT_TO_WORK_VERIFICATION_REQUESTED');

-- CreateTable
CREATE TABLE "verification_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "requested_by_membership_id" UUID NOT NULL,
    "status" "verification_status" NOT NULL DEFAULT 'REQUESTED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "failure_code" VARCHAR(64),
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "outbox_event_type" NOT NULL,
    "verification_request_id" UUID NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_until" TIMESTAMP(3),
    "locked_by" VARCHAR(100),
    "processed_at" TIMESTAMP(3),
    "last_error_code" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_requests_tenant_id_document_id_requested_at_idx" ON "verification_requests"("tenant_id", "document_id", "requested_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "verification_requests_tenant_id_id_key" ON "verification_requests"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_requests_tenant_id_document_version_id_key" ON "verification_requests"("tenant_id", "document_version_id");

-- CreateIndex
CREATE INDEX "outbox_events_processed_at_available_at_locked_until_create_idx" ON "outbox_events"("processed_at", "available_at", "locked_until", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_tenant_id_created_at_idx" ON "outbox_events"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_tenant_id_verification_request_id_type_key" ON "outbox_events"("tenant_id", "verification_request_id", "type");

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "compliance_documents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_tenant_id_document_id_document_versi_fkey" FOREIGN KEY ("tenant_id", "document_id", "document_version_id") REFERENCES "compliance_document_versions"("tenant_id", "document_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_tenant_id_requested_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "requested_by_membership_id") REFERENCES "tenant_memberships"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_verification_request_id_fkey" FOREIGN KEY ("tenant_id", "verification_request_id") REFERENCES "verification_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE public.verification_requests
  ADD CONSTRAINT verification_requests_attempt_count_check
    CHECK (attempt_count >= 0 AND attempt_count <= 3),
  ADD CONSTRAINT verification_requests_failure_code_check
    CHECK (
      failure_code IS NULL
      OR failure_code ~ '^[A-Z0-9_]{1,64}$'
    ),
  ADD CONSTRAINT verification_requests_state_check
    CHECK (
      (status = 'REQUESTED' AND started_at IS NULL AND completed_at IS NULL)
      OR (status = 'PENDING' AND started_at IS NOT NULL AND completed_at IS NULL)
      OR (
        status IN ('VERIFIED', 'FAILED')
        AND started_at IS NOT NULL
        AND completed_at IS NOT NULL
      )
    ),
  ADD CONSTRAINT verification_requests_failure_state_check
    CHECK (
      (status = 'FAILED' AND failure_code IS NOT NULL)
      OR (status <> 'FAILED' AND failure_code IS NULL)
    );

ALTER TABLE public.outbox_events
  ADD CONSTRAINT outbox_events_attempts_check
    CHECK (attempts >= 0 AND attempts <= max_attempts),
  ADD CONSTRAINT outbox_events_max_attempts_check
    CHECK (max_attempts >= 1 AND max_attempts <= 10),
  ADD CONSTRAINT outbox_events_last_error_code_check
    CHECK (
      last_error_code IS NULL
      OR last_error_code ~ '^[A-Z0-9_]{1,64}$'
    ),
  ADD CONSTRAINT outbox_events_lock_check
    CHECK (
      (locked_at IS NULL AND locked_until IS NULL AND locked_by IS NULL)
      OR (
        locked_at IS NOT NULL
        AND locked_until IS NOT NULL
        AND locked_by IS NOT NULL
        AND locked_until > locked_at
      )
    );

ALTER TABLE public.audit_events
  DROP CONSTRAINT audit_events_action_check,
  DROP CONSTRAINT audit_events_record_type_check;

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
      'document:expiry:read',
      'verification:request',
      'verification:read',
      'verification:pending',
      'verification:verified',
      'verification:failed'
    )
  ),
  ADD CONSTRAINT audit_events_record_type_check CHECK (
    record_type IN ('candidate', 'compliance_document', 'verification_request')
  );

GRANT USAGE ON TYPE public.verification_status, public.outbox_event_type
  TO candidate_compliance_app;

GRANT SELECT, INSERT ON TABLE public.verification_requests
  TO candidate_compliance_app;
GRANT UPDATE (
  status,
  attempt_count,
  failure_code,
  started_at,
  completed_at,
  updated_at
) ON TABLE public.verification_requests TO candidate_compliance_app;

GRANT SELECT, INSERT ON TABLE public.outbox_events
  TO candidate_compliance_app;
GRANT UPDATE (
  available_at,
  locked_at,
  locked_until,
  locked_by,
  processed_at,
  last_error_code
) ON TABLE public.outbox_events TO candidate_compliance_app;

ALTER TABLE public.verification_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY verification_requests_tenant_isolation
  ON public.verification_requests
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

ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events FORCE ROW LEVEL SECURITY;

CREATE POLICY outbox_events_tenant_isolation
  ON public.outbox_events
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

CREATE FUNCTION public.claim_next_verification_outbox_event(
  worker_identifier text
)
RETURNS TABLE (
  outbox_event_id uuid,
  tenant_id uuid,
  verification_request_id uuid,
  attempt_count integer,
  max_attempts integer
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
    SELECT event.id
    FROM public.outbox_events AS event
    WHERE event.type = 'RIGHT_TO_WORK_VERIFICATION_REQUESTED'
      AND event.processed_at IS NULL
      AND event.available_at <= pg_catalog.clock_timestamp()
      AND (
        event.locked_until IS NULL
        OR event.locked_until <= pg_catalog.clock_timestamp()
      )
      AND event.attempts < event.max_attempts
    ORDER BY event.available_at, event.created_at, event.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.outbox_events AS event
    SET
      attempts = event.attempts + 1,
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
      event.max_attempts
  )
  SELECT
    claimed.id,
    claimed.tenant_id,
    claimed.verification_request_id,
    claimed.attempts,
    claimed.max_attempts
  FROM claimed;
END
$function$;

ALTER FUNCTION public.claim_next_verification_outbox_event(text)
  OWNER TO candidate_compliance;
REVOKE ALL ON FUNCTION public.claim_next_verification_outbox_event(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_verification_outbox_event(text)
  TO candidate_compliance_app;
