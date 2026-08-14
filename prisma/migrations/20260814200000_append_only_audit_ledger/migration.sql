CREATE TABLE public.audit_events (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  action text NOT NULL,
  record_type text NOT NULL,
  record_id uuid NOT NULL,
  before_hash char(64),
  after_hash char(64) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT audit_events_action_check CHECK (
    action IN (
      'candidate:create',
      'candidate:update',
      'candidate:read',
      'candidate:list:read',
      'document:create',
      'document:version:create',
      'document:read',
      'document:list:read',
      'document:expiry:read'
    )
  ),
  CONSTRAINT audit_events_record_type_check CHECK (
    record_type IN ('candidate', 'compliance_document')
  ),
  CONSTRAINT audit_events_before_hash_check CHECK (
    before_hash IS NULL OR before_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT audit_events_after_hash_check CHECK (
    after_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT audit_events_metadata_object_check CHECK (
    pg_catalog.jsonb_typeof(metadata) = 'object'
  ),
  CONSTRAINT audit_events_pkey PRIMARY KEY (id)
);

CREATE INDEX audit_events_tenant_id_created_at_id_idx
  ON public.audit_events(tenant_id, created_at DESC, id);

CREATE INDEX audit_events_tenant_id_record_type_record_id_created_at_idx
  ON public.audit_events(
    tenant_id,
    record_type,
    record_id,
    created_at DESC
  );

GRANT INSERT ON TABLE public.audit_events TO candidate_compliance_app;

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_events_tenant_insert
  ON public.audit_events
  FOR INSERT
  TO candidate_compliance_app
  WITH CHECK (
    tenant_id = NULLIF(
      pg_catalog.current_setting('app.current_tenant_id', true),
      ''
    )::uuid
  );
