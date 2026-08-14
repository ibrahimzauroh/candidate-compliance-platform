ALTER TABLE public.compliance_document_versions
  DROP CONSTRAINT compliance_document_versions_tenant_id_created_by_fkey;

CREATE UNIQUE INDEX tenant_memberships_tenant_id_id_key
  ON public.tenant_memberships(tenant_id, id);

UPDATE public.compliance_document_versions AS version
SET created_by = membership.id
FROM public.tenant_memberships AS membership
WHERE membership.tenant_id = version.tenant_id
  AND membership.user_id = version.created_by;

ALTER TABLE public.compliance_document_versions
  ADD CONSTRAINT compliance_document_versions_tenant_id_created_by_fkey
  FOREIGN KEY (tenant_id, created_by)
  REFERENCES public.tenant_memberships(tenant_id, id)
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

GRANT INSERT, UPDATE ON TABLE public.compliance_documents
  TO candidate_compliance_app;
GRANT INSERT ON TABLE public.compliance_document_versions
  TO candidate_compliance_app;
