CREATE TABLE public.idempotency_records (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  operation text NOT NULL,
  key text NOT NULL,
  request_hash char(64) NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT idempotency_records_response_status_check
    CHECK (response_status >= 200 AND response_status < 300),
  CONSTRAINT idempotency_records_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX idempotency_records_tenant_id_membership_id_operation_key_key
  ON public.idempotency_records(tenant_id, membership_id, operation, key);

CREATE INDEX idempotency_records_tenant_id_created_at_idx
  ON public.idempotency_records(tenant_id, created_at);

ALTER TABLE public.idempotency_records
  ADD CONSTRAINT idempotency_records_tenant_id_fkey
  FOREIGN KEY (tenant_id)
  REFERENCES public.tenants(id)
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE public.idempotency_records
  ADD CONSTRAINT idempotency_records_tenant_id_membership_id_fkey
  FOREIGN KEY (tenant_id, membership_id)
  REFERENCES public.tenant_memberships(tenant_id, id)
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

GRANT SELECT, INSERT ON TABLE public.idempotency_records
  TO candidate_compliance_app;

ALTER TABLE public.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_records FORCE ROW LEVEL SECURITY;

CREATE POLICY idempotency_records_tenant_isolation
  ON public.idempotency_records
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
