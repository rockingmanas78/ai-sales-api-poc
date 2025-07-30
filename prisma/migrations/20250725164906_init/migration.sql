-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('FREE', 'PRO', 'GROWTH', 'STARTER');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPERADMIN', 'ADMIN', 'MANAGER');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NOT_INTERESTED', 'FOLLOW_UP', 'INTERESTED', 'IMMEDIATE_ACTION');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'OPENED', 'CLICKED', 'REPLIED', 'BOUNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "BulkEmailJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'PAUSED', 'FAILED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ZoneCode" AS ENUM ('IN', 'US', 'EU', 'AE', 'ROW');

-- CreateEnum
CREATE TYPE "MeterMetric" AS ENUM ('JOB', 'CLASSIFICATION', 'SEAT');

-- CreateEnum
CREATE TYPE "CapPeriod" AS ENUM ('DAY', 'MONTH', 'PERIOD');

-- CreateEnum
CREATE TYPE "BillingCadence" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "Experiment" AS ENUM ('PUBLIC', 'A', 'B', 'C');

-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('COLD_OUTREACH', 'FOLLOW_UP_SEQUENCE', 'LEAD_NURTURING', 'RE_ENGAGEMENT');

-- CreateEnum
CREATE TYPE "lead_source" AS ENUM ('AI_GENERATED', 'CSV_UPLOAD', 'MANUAL_ENTRY');

-- CreateEnum
CREATE TYPE "crawl_status" AS ENUM ('PENDING', 'CRAWLING', 'READY', 'ERROR');

-- CreateEnum
CREATE TYPE "document_status" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'ERROR');

-- CreateEnum
CREATE TYPE "AcquisitionChannel" AS ENUM ('GOOGLE_SEARCH', 'SOCIAL_MEDIA', 'REFERRAL', 'ADVERTISEMENT', 'BLOG', 'OTHER');

-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('BUG_REPORT', 'FEATURE_REQUEST', 'GENERAL_COMMENT', 'TESTIMONIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "OnboardingRole" AS ENUM ('FOUNDER_CEO', 'SALES_MANAGER', 'MARKETING_MANAGER', 'BUSINESS_DEV', 'OTHER');

-- CreateEnum
CREATE TYPE "SalesGoal" AS ENUM ('INCREASE_LEADS', 'IMPROVE_CONVERSION', 'AUTOMATE_PROCESS', 'BETTER_TRACKING', 'TEAM_COLLABORATION');

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanVersion" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "zone" "ZoneCode" NOT NULL,
    "bucket" "Experiment" NOT NULL,
    "cadence" "BillingCadence" NOT NULL,
    "currency" TEXT NOT NULL,
    "basePriceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Component" (
    "id" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "metric" "MeterMetric" NOT NULL,
    "includedQty" INTEGER NOT NULL,
    "capPeriod" "CapPeriod" NOT NULL,
    "overageCents" INTEGER NOT NULL,

    CONSTRAINT "Component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceId" (
    "id" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "externalPriceId" TEXT NOT NULL,

    CONSTRAINT "PriceId_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "PlanType" NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "countryCode" TEXT,
    "zone" "ZoneCode" NOT NULL DEFAULT 'IN',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "zone" "ZoneCode" NOT NULL,
    "status" TEXT NOT NULL,
    "currentStart" TIMESTAMP(3) NOT NULL,
    "currentEnd" TIMESTAMP(3) NOT NULL,
    "brokerId" TEXT,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "metric" "MeterMetric" NOT NULL,
    "qty" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCapCounter" (
    "tenantId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "metric" "MeterMetric" NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "DailyCapCounter_pkey" PRIMARY KEY ("tenantId","date","metric")
);

-- CreateTable
CREATE TABLE "CampaignLead" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MANAGER',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactEmail" TEXT[],
    "contactName" TEXT,
    "contactPhone" TEXT[],
    "status" "LeadStatus" NOT NULL DEFAULT 'FOLLOW_UP',
    "confidence" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "contactAddress" TEXT[],
    "source" "lead_source" NOT NULL DEFAULT 'AI_GENERATED',

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainIdentity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "domainName" TEXT NOT NULL,
    "verificationToken" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'Pending',
    "dkimTokens" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "dkimRecords" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "DomainIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailIdentity" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'Pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EmailIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variable" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "defaultValue" TEXT,
    "templateId" TEXT NOT NULL,

    CONSTRAINT "Variable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "campaign_type" "CampaignType" NOT NULL,

    CONSTRAINT "EmailCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkEmailJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "campaignId" TEXT,
    "rateLimit" INTEGER NOT NULL,
    "status" "BulkEmailJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "nextProcessTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastProcessedAt" TIMESTAMP(3),

    CONSTRAINT "BulkEmailJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkEmailJobLead" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "BulkEmailJobLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadGenerationJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "prompt" TEXT,
    "industry" TEXT,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "totalRequested" INTEGER NOT NULL,
    "generatedCount" INTEGER NOT NULL DEFAULT 0,
    "urls" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "LeadGenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "phonepeOrderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkSnippet" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_snippet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyProfile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "description" TEXT,
    "mission" TEXT,
    "values" TEXT,
    "usp" TEXT,
    "history" TEXT,
    "key_personnel" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offering_description" TEXT,
    "target_market" TEXT,

    CONSTRAINT "company_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyQA" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,

    CONSTRAINT "company_qa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "extracted_text" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "knowledge_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "features" TEXT,
    "benefits" TEXT,
    "pricing" TEXT,
    "target_audience" TEXT,
    "use_cases" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductQA" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,

    CONSTRAINT "product_qa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteContent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "crawl_summary" TEXT,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "website_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "category" "FeedbackCategory" NOT NULL DEFAULT 'GENERAL_COMMENT',
    "rating" INTEGER,
    "page" TEXT,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantOnboarding" (
    "tenant_id" TEXT NOT NULL,
    "role" "OnboardingRole" NOT NULL,
    "hear_about_us" "AcquisitionChannel" NOT NULL,
    "primary_goal" "SalesGoal" NOT NULL,
    "createdat" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantOnboarding_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "TenantRAG" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "embedding" vector,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantRAG_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitListMembers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "whatsapp_number" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wait_list_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PlanVersion_planId_zone_bucket_cadence_version_key" ON "PlanVersion"("planId", "zone", "bucket", "cadence", "version");

-- CreateIndex
CREATE INDEX "UsageEvent_tenantId_recordedAt_idx" ON "UsageEvent"("tenantId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLead_campaignId_leadId_key" ON "CampaignLead"("campaignId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Lead_tenantId_status_idx" ON "Lead"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DomainIdentity_domainName_key" ON "DomainIdentity"("domainName");

-- CreateIndex
CREATE UNIQUE INDEX "EmailIdentity_emailAddress_key" ON "EmailIdentity"("emailAddress");

-- CreateIndex
CREATE INDEX "EmailLog_tenantId_status_idx" ON "EmailLog"("tenantId", "status");

-- CreateIndex
CREATE INDEX "BulkEmailJob_tenantId_status_idx" ON "BulkEmailJob"("tenantId", "status");

-- CreateIndex
CREATE INDEX "BulkEmailJob_status_nextProcessTime_idx" ON "BulkEmailJob"("status", "nextProcessTime");

-- CreateIndex
CREATE UNIQUE INDEX "BulkEmailJobLead_jobId_leadId_key" ON "BulkEmailJobLead"("jobId", "leadId");

-- CreateIndex
CREATE INDEX "LeadGenerationJob_tenantId_status_idx" ON "LeadGenerationJob"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "company_profile_tenant_id_key" ON "CompanyProfile"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_company_qa_company_category" ON "CompanyQA"("company_id", "category");

-- CreateIndex
CREATE INDEX "idx_knowledge_document_status" ON "KnowledgeDocument"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "idx_website_content_status" ON "WebsiteContent"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "idx_feedback_tenant_category" ON "Feedback"("tenant_id", "category");

-- CreateIndex
CREATE INDEX "idx_feedback_tenant_created_at" ON "Feedback"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "TenantRAG_embedding_idx" ON "TenantRAG"("embedding");

-- CreateIndex
CREATE INDEX "idx_tenant_rag_tenant_id" ON "TenantRAG"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenantrag_unique_tenant_source_sourceid" ON "TenantRAG"("tenant_id", "source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "wait_list_members_email_key" ON "WaitListMembers"("email");

-- AddForeignKey
ALTER TABLE "PlanVersion" ADD CONSTRAINT "PlanVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Component" ADD CONSTRAINT "Component_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceId" ADD CONSTRAINT "PriceId_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "EmailCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainIdentity" ADD CONSTRAINT "DomainIdentity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailIdentity" ADD CONSTRAINT "EmailIdentity_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "DomainIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variable" ADD CONSTRAINT "Variable_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "EmailCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkEmailJob" ADD CONSTRAINT "BulkEmailJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "EmailCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkEmailJob" ADD CONSTRAINT "BulkEmailJob_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkEmailJob" ADD CONSTRAINT "BulkEmailJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkEmailJobLead" ADD CONSTRAINT "BulkEmailJobLead_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BulkEmailJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkEmailJobLead" ADD CONSTRAINT "BulkEmailJobLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadGenerationJob" ADD CONSTRAINT "LeadGenerationJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "fk_paymenttransaction_subscription" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "fk_paymenttransaction_tenant" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BulkSnippet" ADD CONSTRAINT "bulk_snippet_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CompanyProfile" ADD CONSTRAINT "company_profile_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CompanyQA" ADD CONSTRAINT "company_qa_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "CompanyProfile"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "knowledge_document_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "product_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "CompanyProfile"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProductQA" ADD CONSTRAINT "product_qa_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WebsiteContent" ADD CONSTRAINT "website_content_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "fk_feedback_tenant" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TenantOnboarding" ADD CONSTRAINT "TenantOnboarding_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
