CREATE TYPE "cv_extraction_purpose" AS ENUM ('CANDIDATE_PROFILE');
CREATE TYPE "cv_extraction_status" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED');

CREATE TABLE public.cv_extractions (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  requested_by_user_id uuid NOT NULL,
  requested_by_membership_id uuid NOT NULL,
  purpose cv_extraction_purpose NOT NULL DEFAULT 'CANDIDATE_PROFILE',
  provider varchar(100) NOT NULL,
  model varchar(100) NOT NULL,
  proposed_output jsonb NOT NULL,
  status cv_extraction_status NOT NULL DEFAULT 'PROPOSED',
  reviewed_by_user_id uuid,
  reviewed_by_membership_id uuid,
  decided_at timestamp(3),
  confirmed_output jsonb,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL,

  CONSTRAINT cv_extractions_pkey PRIMARY KEY (id),
  CONSTRAINT cv_extractions_proposed_output_check CHECK (
    pg_catalog.jsonb_typeof(proposed_output) = 'object'
  ),
  CONSTRAINT cv_extractions_confirmed_output_check CHECK (
    confirmed_output IS NULL
    OR pg_catalog.jsonb_typeof(confirmed_output) = 'object'
  ),
  CONSTRAINT cv_extractions_decision_state_check CHECK (
    (
      status = 'PROPOSED'
      AND reviewed_by_user_id IS NULL
      AND reviewed_by_membership_id IS NULL
      AND decided_at IS NULL
      AND confirmed_output IS NULL
    )
    OR (
      status = 'ACCEPTED'
      AND reviewed_by_user_id IS NOT NULL
      AND reviewed_by_membership_id IS NOT NULL
      AND decided_at IS NOT NULL
      AND confirmed_output IS NOT NULL
    )
    OR (
      status = 'REJECTED'
      AND reviewed_by_user_id IS NOT NULL
      AND reviewed_by_membership_id IS NOT NULL
      AND decided_at IS NOT NULL
      AND confirmed_output IS NULL
    )
  )
);

CREATE TABLE public.candidate_profiles (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  source_extraction_id uuid NOT NULL,
  full_name varchar(200) NOT NULL,
  skills jsonb NOT NULL,
  years_of_experience integer NOT NULL,
  certifications jsonb NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL,

  CONSTRAINT candidate_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT candidate_profiles_skills_check CHECK (
    pg_catalog.jsonb_typeof(skills) = 'array'
  ),
  CONSTRAINT candidate_profiles_years_check CHECK (
    years_of_experience >= 0 AND years_of_experience <= 80
  ),
  CONSTRAINT candidate_profiles_certifications_check CHECK (
    pg_catalog.jsonb_typeof(certifications) = 'array'
  )
);

CREATE UNIQUE INDEX cv_extractions_tenant_id_id_key
  ON public.cv_extractions(tenant_id, id);
CREATE UNIQUE INDEX cv_extractions_tenant_id_candidate_id_id_key
  ON public.cv_extractions(tenant_id, candidate_id, id);
CREATE INDEX cv_extractions_tenant_id_candidate_id_created_at_id_idx
  ON public.cv_extractions(tenant_id, candidate_id, created_at DESC, id);

CREATE UNIQUE INDEX candidate_profiles_tenant_id_id_key
  ON public.candidate_profiles(tenant_id, id);
CREATE UNIQUE INDEX candidate_profiles_tenant_id_candidate_id_key
  ON public.candidate_profiles(tenant_id, candidate_id);
CREATE UNIQUE INDEX candidate_profiles_tenant_id_candidate_id_source_extraction_id_key
  ON public.candidate_profiles(tenant_id, candidate_id, source_extraction_id);

ALTER TABLE public.cv_extractions
  ADD CONSTRAINT cv_extractions_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT cv_extractions_tenant_id_candidate_id_fkey
    FOREIGN KEY (tenant_id, candidate_id)
    REFERENCES public.candidates(tenant_id, id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT cv_extractions_requested_by_user_id_fkey
    FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT cv_extractions_reviewed_by_user_id_fkey
    FOREIGN KEY (reviewed_by_user_id) REFERENCES public.users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT cv_extractions_tenant_id_requested_by_membership_id_fkey
    FOREIGN KEY (tenant_id, requested_by_membership_id)
    REFERENCES public.tenant_memberships(tenant_id, id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT cv_extractions_tenant_id_reviewed_by_membership_id_fkey
    FOREIGN KEY (tenant_id, reviewed_by_membership_id)
    REFERENCES public.tenant_memberships(tenant_id, id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE public.candidate_profiles
  ADD CONSTRAINT candidate_profiles_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT candidate_profiles_tenant_id_candidate_id_fkey
    FOREIGN KEY (tenant_id, candidate_id)
    REFERENCES public.candidates(tenant_id, id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT candidate_profiles_tenant_id_candidate_id_source_extract_fkey
    FOREIGN KEY (tenant_id, candidate_id, source_extraction_id)
    REFERENCES public.cv_extractions(tenant_id, candidate_id, id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

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
      'verification:failed',
      'ai:extract',
      'ai:read',
      'ai:confirm',
      'ai:reject'
    )
  ),
  ADD CONSTRAINT audit_events_record_type_check CHECK (
    record_type IN (
      'candidate',
      'compliance_document',
      'verification_request',
      'cv_extraction'
    )
  );

GRANT USAGE ON TYPE public.cv_extraction_purpose, public.cv_extraction_status
  TO candidate_compliance_app;

GRANT SELECT, INSERT ON TABLE public.cv_extractions
  TO candidate_compliance_app;
GRANT UPDATE (
  status,
  reviewed_by_user_id,
  reviewed_by_membership_id,
  decided_at,
  confirmed_output,
  updated_at
) ON TABLE public.cv_extractions TO candidate_compliance_app;

GRANT SELECT, INSERT ON TABLE public.candidate_profiles
  TO candidate_compliance_app;
GRANT UPDATE (
  source_extraction_id,
  full_name,
  skills,
  years_of_experience,
  certifications,
  updated_at
) ON TABLE public.candidate_profiles TO candidate_compliance_app;

ALTER TABLE public.cv_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cv_extractions FORCE ROW LEVEL SECURITY;

CREATE POLICY cv_extractions_tenant_isolation
  ON public.cv_extractions
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

ALTER TABLE public.candidate_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY candidate_profiles_tenant_isolation
  ON public.candidate_profiles
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
