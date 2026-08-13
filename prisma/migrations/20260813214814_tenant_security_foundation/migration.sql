-- EnableExtension
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateEnum
CREATE TYPE "tenant_role" AS ENUM ('ADMIN', 'RECRUITER', 'COMPLIANCE_OFFICER', 'VIEWER');

-- CreateEnum
CREATE TYPE "compliance_document_type" AS ENUM ('RIGHT_TO_WORK', 'BACKGROUND_CHECK', 'PROFESSIONAL_CERTIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "compliance_document_status" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_memberships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "tenant_role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "role_applied_for" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "type" "compliance_document_type" NOT NULL,
    "current_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_document_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "issue_date" DATE,
    "expiry_date" DATE,
    "status" "compliance_document_status" NOT NULL DEFAULT 'DRAFT',
    "supersedes_version_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_document_versions_version_number_check" CHECK ("version_number" > 0),
    CONSTRAINT "compliance_document_versions_date_order_check" CHECK ("expiry_date" IS NULL OR "issue_date" IS NULL OR "expiry_date" >= "issue_date"),
    CONSTRAINT "compliance_document_versions_supersedes_not_self_check" CHECK ("supersedes_version_id" IS NULL OR "supersedes_version_id" <> "id"),
    CONSTRAINT "compliance_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "tenant_memberships_user_id_idx" ON "tenant_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_tenant_id_user_id_key" ON "tenant_memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "candidates_tenant_id_created_at_id_idx" ON "candidates"("tenant_id", "created_at" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_tenant_id_email_key" ON "candidates"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_tenant_id_id_key" ON "candidates"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "compliance_documents_tenant_id_candidate_id_created_at_id_idx" ON "compliance_documents"("tenant_id", "candidate_id", "created_at" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_documents_tenant_id_id_key" ON "compliance_documents"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_document_versions_tenant_id_document_id_version__key" ON "compliance_document_versions"("tenant_id", "document_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_document_versions_tenant_id_document_id_id_key" ON "compliance_document_versions"("tenant_id", "document_id", "id");

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_tenant_id_candidate_id_fkey" FOREIGN KEY ("tenant_id", "candidate_id") REFERENCES "candidates"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_tenant_id_id_current_version_id_fkey" FOREIGN KEY ("tenant_id", "id", "current_version_id") REFERENCES "compliance_document_versions"("tenant_id", "document_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_document_versions" ADD CONSTRAINT "compliance_document_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_document_versions" ADD CONSTRAINT "compliance_document_versions_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "compliance_documents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_document_versions" ADD CONSTRAINT "compliance_document_versions_tenant_id_document_id_superse_fkey" FOREIGN KEY ("tenant_id", "document_id", "supersedes_version_id") REFERENCES "compliance_document_versions"("tenant_id", "document_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_document_versions" ADD CONSTRAINT "compliance_document_versions_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "tenant_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
