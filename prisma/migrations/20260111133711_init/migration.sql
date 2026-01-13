-- CreateEnum
CREATE TYPE "public"."AcquisitionChannel" AS ENUM ('GOOGLE_SEARCH', 'SOCIAL_MEDIA', 'REFERRAL', 'ADVERTISEMENT', 'BLOG', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."BillingCadence" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "public"."BulkEmailJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'PAUSED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."CalendarProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- CreateEnum
CREATE TYPE "public"."CalendarSystem" AS ENUM ('GOOGLE', 'MICROSOFT', 'ICS');

-- CreateEnum
CREATE TYPE "public"."CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."CampaignType" AS ENUM ('COLD_OUTREACH', 'FOLLOW_UP_SEQUENCE', 'LEAD_NURTURING', 'RE_ENGAGEMENT', 'WARMUP');

-- CreateEnum
CREATE TYPE "public"."CapPeriod" AS ENUM ('DAY', 'MONTH', 'PERIOD');

-- CreateEnum
CREATE TYPE "public"."DedupePolicy" AS ENUM ('EMAIL', 'LINKEDIN', 'PHONE', 'DOMAIN_PLUS_NAME', 'NONE');

-- CreateEnum
CREATE TYPE "public"."EmailStatus" AS ENUM ('QUEUED', 'SENT', 'OPENED', 'CLICKED', 'REPLIED', 'BOUNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."EmailType" AS ENUM ('MANUAL', 'AI_GENERATED', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "public"."Experiment" AS ENUM ('PUBLIC', 'A', 'B', 'C');

-- CreateEnum
CREATE TYPE "public"."FeedbackCategory" AS ENUM ('BUG_REPORT', 'FEATURE_REQUEST', 'GENERAL_COMMENT', 'TESTIMONIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ImportMode" AS ENUM ('INSERT_ONLY', 'UPSERT', 'DRY_RUN');

-- CreateEnum
CREATE TYPE "public"."LeadStatus" AS ENUM ('NOT_INTERESTED', 'FOLLOW_UP', 'INTERESTED', 'IMMEDIATE_ACTION');

-- CreateEnum
CREATE TYPE "public"."MeetingIntentStatus" AS ENUM ('OFFERED', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."MeterMetric" AS ENUM ('JOB', 'CLASSIFICATION', 'SEAT', 'EMAILS');

-- CreateEnum
CREATE TYPE "public"."OnboardingRole" AS ENUM ('FOUNDER_CEO', 'SALES_MANAGER', 'MARKETING_MANAGER', 'BUSINESS_DEV', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."PaymentGateway" AS ENUM ('RAZORPAY', 'STRIPE', 'WISE');

-- CreateEnum
CREATE TYPE "public"."PlanType" AS ENUM ('FREE', 'PRO', 'GROWTH', 'STARTER');

-- CreateEnum
CREATE TYPE "public"."RowProcessStatus" AS ENUM ('QUEUED', 'PROCESSED', 'DUPLICATE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "public"."SalesGoal" AS ENUM ('INCREASE_LEADS', 'IMPROVE_CONVERSION', 'AUTOMATE_PROCESS', 'BETTER_TRACKING', 'TEAM_COLLABORATION');

-- CreateEnum
CREATE TYPE "public"."SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED', 'PENDING');

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('SUPERADMIN', 'ADMIN', 'MANAGER');

-- CreateEnum
CREATE TYPE "public"."ZoneCode" AS ENUM ('IN', 'US', 'EU', 'AE', 'ROW');

-- CreateEnum
CREATE TYPE "public"."crawl_status" AS ENUM ('PENDING', 'CRAWLING', 'READY', 'ERROR');

-- CreateEnum
CREATE TYPE "public"."document_status" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'ERROR');

-- CreateEnum
CREATE TYPE "public"."email_direction" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "public"."lead_source" AS ENUM ('AI_GENERATED', 'CSV_UPLOAD', 'MANUAL_ENTRY');

-- CreateEnum
CREATE TYPE "public"."EmailVerificationStatus" AS ENUM ('PENDING', 'VALID', 'INVALID', 'CATCH_ALL', 'RISKY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "public"."WarmupAction" AS ENUM ('OPENED', 'REPLIED', 'MOVED_FROM_SPAM', 'STARRED', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."WarmupInboxStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "public"."WarmupMode" AS ENUM ('OFF', 'AUTO', 'MANUAL_ONLY');

-- CreateEnum
CREATE TYPE "public"."WarmupStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateTable
CREATE TABLE "public"."AppEvent" (
    "event_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_name" TEXT NOT NULL,
    "user_id" TEXT,
    "anonymous_id" TEXT,
    "session_id" TEXT,
    "tenant_id" TEXT,
    "source" TEXT,
    "page_url" TEXT,
    "referrer" TEXT,
    "ip" INET,
    "user_agent" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "context" JSONB NOT NULL DEFAULT '{}',
    "event_version" SMALLINT NOT NULL DEFAULT 1,
    "schema_key" TEXT,
    "event_type" TEXT NOT NULL DEFAULT 'UI',

    CONSTRAINT "app_event_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "public"."BulkEmailJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT,
    "campaignId" TEXT,
    "rateLimit" INTEGER NOT NULL,
    "status" "public"."BulkEmailJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "nextProcessTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastProcessedAt" TIMESTAMP(3),
    "isWarmup" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BulkEmailJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BulkEmailJobLead" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" "public"."EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "BulkEmailJobLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BulkSnippet" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_snippet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CalendarConnection" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "public"."CalendarProvider" NOT NULL,
    "accountEmail" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMPTZ(6),
    "scope" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CampaignLead" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CompanyProfile" (
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
CREATE TABLE "public"."CompanyQA" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,

    CONSTRAINT "company_qa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Component" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "planVersionId" TEXT NOT NULL,
    "metric" "public"."MeterMetric" NOT NULL,
    "includedQty" INTEGER NOT NULL,
    "capPeriod" "public"."CapPeriod" NOT NULL,
    "overageCents" INTEGER NOT NULL,

    CONSTRAINT "Component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Conversation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "threadKey" TEXT NOT NULL,
    "subject" TEXT,
    "participants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstMessageAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CsvImportJob" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "importMode" "public"."ImportMode" NOT NULL DEFAULT 'UPSERT',
    "dedupePolicy" "public"."DedupePolicy" NOT NULL DEFAULT 'EMAIL',
    "delimiter" TEXT,
    "headerRow" INTEGER,
    "columnMapping" JSONB,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "name" TEXT,

    CONSTRAINT "CsvImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CsvImportRow" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jobId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "status" "public"."RowProcessStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "createdLeadId" UUID,
    "processedAt" TIMESTAMPTZ(6),
    "retryCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CsvImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DailyCapCounter" (
    "tenantId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "metric" "public"."MeterMetric" NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "DailyCapCounter_pkey" PRIMARY KEY ("tenantId","date","metric")
);

-- CreateTable
CREATE TABLE "public"."DomainIdentity" (
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
CREATE TABLE "public"."EmailCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "public"."CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "campaign_type" "public"."CampaignType" NOT NULL,

    CONSTRAINT "EmailCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmailEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "emailMessageId" UUID NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "snsMessageId" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bounceType" TEXT,
    "bounceSubType" TEXT,
    "complaintType" TEXT,
    "recipient" TEXT,
    "recipientDomain" TEXT,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmailIdentity" (
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
CREATE TABLE "public"."EmailMessage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "conversationId" UUID NOT NULL,
    "direction" "public"."email_direction" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'AWS_SES',
    "providerMessageId" TEXT NOT NULL,
    "subject" TEXT,
    "from" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "text" TEXT,
    "html" TEXT,
    "headers" JSONB,
    "verdicts" JSONB,
    "inReplyTo" TEXT,
    "referencesIds" TEXT[],
    "plusToken" TEXT,
    "s3Bucket" TEXT,
    "s3Key" TEXT,
    "receivedAt" TIMESTAMPTZ(6),
    "sentAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaignId" TEXT,
    "leadId" TEXT,
    "lastDeliveryStatus" TEXT,
    "firstOpenedAt" TIMESTAMPTZ(6),
    "opensCount" INTEGER DEFAULT 0,
    "clicksCount" INTEGER DEFAULT 0,
    "lastEventAt" TIMESTAMPTZ(6),
    "isWarmup" BOOLEAN NOT NULL DEFAULT false,
    "warmupMarker" TEXT,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmailTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "preheader" TEXT,
    "unsubscribe_url" TEXT,
    "logo_url" TEXT,
    "brand_colors" JSONB,
    "font_family" TEXT,
    "show_header" BOOLEAN NOT NULL DEFAULT true,
    "show_footer" BOOLEAN NOT NULL DEFAULT true,
    "text_part" TEXT,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Feedback" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "category" "public"."FeedbackCategory" NOT NULL DEFAULT 'GENERAL_COMMENT',
    "rating" INTEGER,
    "page" TEXT,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GeneratedEmail" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledDate" TIMESTAMP(6),
    "emailMessageId" UUID,

    CONSTRAINT "GeneratedEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InboundReceipt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "snsMessageId" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "s3Bucket" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),

    CONSTRAINT "InboundReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."KnowledgeDocument" (
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
CREATE TABLE "public"."Lead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactEmail" TEXT[],
    "contactName" TEXT,
    "contactPhone" TEXT[],
    "status" "public"."LeadStatus" NOT NULL DEFAULT 'FOLLOW_UP',
    "confidence" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "contactAddress" TEXT[],
    "source" "public"."lead_source" NOT NULL DEFAULT 'AI_GENERATED',
    "linkedInUrl" TEXT,
    "companySize" INTEGER DEFAULT 0,
    "jobId" TEXT,
    "description" TEXT,
    "csvJobId" UUID,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeadGenerationJob" (
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
CREATE TABLE "public"."MeetingBooking" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "intentId" UUID NOT NULL,
    "finalStart" TIMESTAMPTZ(6) NOT NULL,
    "finalEnd" TIMESTAMPTZ(6) NOT NULL,
    "calendarSystem" "public"."CalendarSystem" NOT NULL,
    "eventId" TEXT,
    "icsUid" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MeetingIntent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "public"."MeetingIntentStatus" NOT NULL DEFAULT 'OFFERED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MeetingOffer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "intentId" UUID NOT NULL,
    "slotStart" TIMESTAMPTZ(6) NOT NULL,
    "slotEnd" TIMESTAMPTZ(6) NOT NULL,
    "recipientTz" TEXT NOT NULL DEFAULT 'UTC',
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaymentTransaction" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceId" TEXT,
    "invoiceUrl" TEXT,
    "paymentId" TEXT,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlanVersion" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "planId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "zone" "public"."ZoneCode" NOT NULL,
    "bucket" "public"."Experiment" NOT NULL,
    "cadence" "public"."BillingCadence" NOT NULL,
    "currency" TEXT NOT NULL,
    "basePriceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PriceId" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "planVersionId" TEXT NOT NULL,
    "gateway" "public"."PaymentGateway" NOT NULL,
    "price" INTEGER,
    "externalPriceId" TEXT NOT NULL,
    "gatewayPlanId" TEXT,

    CONSTRAINT "PriceId_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Product" (
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
CREATE TABLE "public"."ProductQA" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,

    CONSTRAINT "product_qa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RagReadiness" (
    "tenant_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "components" JSONB NOT NULL,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagReadiness_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "public"."Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "zone" "public"."ZoneCode" NOT NULL,
    "status" TEXT NOT NULL,
    "currentStart" TIMESTAMP(3) NOT NULL,
    "currentEnd" TIMESTAMP(3) NOT NULL,
    "brokerId" TEXT,
    "planPriceId" TEXT,
    "cycle" TEXT DEFAULT 'MONTHLY',
    "nextBillingAt" TIMESTAMPTZ(6),
    "provider" TEXT,
    "providerSubId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerCustId" TEXT,
    "cancelAtCycleEnd" BOOLEAN,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "public"."PlanType" NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "countryCode" TEXT,
    "zone" "public"."ZoneCode" NOT NULL DEFAULT 'IN',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TenantOnboarding" (
    "tenant_id" TEXT NOT NULL,
    "role" "public"."OnboardingRole" NOT NULL,
    "hear_about_us" "public"."AcquisitionChannel" NOT NULL,
    "primary_goal" "public"."SalesGoal" NOT NULL,
    "createdat" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantOnboarding_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "public"."TenantRAG" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "embedding" vector,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chunk_hash" TEXT,
    "version" INTEGER DEFAULT 1,
    "is_active" BOOLEAN DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "embedding_model" TEXT,
    "simhash_bigint" BIGINT,

    CONSTRAINT "TenantRAG_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UsageCounter" (
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "metric" "public"."MeterMetric" NOT NULL,
    "windowType" "public"."CapPeriod" NOT NULL,
    "windowStart" TIMESTAMPTZ(6) NOT NULL,
    "windowEnd" TIMESTAMPTZ(6),
    "qty" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("tenantId","subscriptionId","metric","windowType","windowStart")
);

-- CreateTable
CREATE TABLE "public"."UsageEvent" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "metric" "public"."MeterMetric" NOT NULL,
    "qty" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscriptionId" TEXT,
    "idempotencyKey" TEXT,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "public"."UserRole" NOT NULL DEFAULT 'MANAGER',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "oauthProvider" VARCHAR(32),
    "oauthId" TEXT,
    "name" VARCHAR(120),
    "phoneNumber" VARCHAR(32),
    "location" VARCHAR(120),
    "bio" TEXT,
    "avatarUrl" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Variable" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "defaultValue" TEXT,
    "templateId" TEXT NOT NULL,

    CONSTRAINT "Variable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WaitListMembers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "whatsapp_number" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wait_list_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WebhookEvent" (
    "eventId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMPTZ(6),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "public"."WebsiteContent" (
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
CREATE TABLE "public"."identity_link" (
    "anonymous_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_link_pkey" PRIMARY KEY ("anonymous_id","user_id")
);

-- CreateTable
CREATE TABLE "public"."EmailVerification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT,
    "email" TEXT NOT NULL,
    "status" "public"."EmailVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "score" INTEGER,
    "reason" TEXT,
    "provider" TEXT,
    "rawPayload" JSONB NOT NULL DEFAULT '{}',
    "checkedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmailWarmupProfile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "emailIdentityId" TEXT NOT NULL,
    "mode" "public"."WarmupMode" NOT NULL DEFAULT 'AUTO',
    "status" "public"."WarmupStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetDailyMax" INTEGER NOT NULL DEFAULT 50,
    "currentDailyMax" INTEGER NOT NULL DEFAULT 5,
    "lastAdjustedAt" TIMESTAMPTZ(6),
    "providerHint" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailWarmupProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WarmupDailyStat" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "emailIdentityId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "plannedSends" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "bounceCount" INTEGER NOT NULL DEFAULT 0,
    "complaintCount" INTEGER NOT NULL DEFAULT 0,
    "spamFolderCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarmupDailyStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WarmupInbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "provider" TEXT,
    "domain" TEXT NOT NULL,
    "label" TEXT,
    "ownerTenantId" TEXT,
    "autoEngagementEnabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "public"."WarmupInboxStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxDailyVolume" INTEGER NOT NULL DEFAULT 100,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarmupInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WarmupInboxEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warmupInboxId" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "emailMessageId" UUID,
    "action" "public"."WarmupAction" NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "WarmupInboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WarmupMessage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "threadId" UUID NOT NULL,
    "direction" "public"."email_direction" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'AWS_SES',
    "providerMessageId" TEXT,
    "subject" TEXT,
    "from" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "text" TEXT,
    "html" TEXT,
    "headers" JSONB DEFAULT '{}',
    "warmupMarker" TEXT NOT NULL,
    "configurationSet" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(6),
    "receivedAt" TIMESTAMPTZ(6),

    CONSTRAINT "WarmupMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WarmupMessageEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "warmupMessageId" UUID NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "snsMessageId" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "recipient" TEXT,
    "recipientDomain" TEXT,
    "bounceType" TEXT,
    "complaintType" TEXT,

    CONSTRAINT "WarmupMessageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WarmupThread" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "threadKey" TEXT NOT NULL,
    "profileId" UUID NOT NULL,
    "inboxId" UUID,
    "subject" TEXT,
    "participants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarmupThread_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_app_event_name_time" ON "public"."AppEvent"("event_name", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "idx_app_event_time" ON "public"."AppEvent"("occurred_at");

-- CreateIndex
CREATE INDEX "idx_app_event_user_time" ON "public"."AppEvent"("user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "BulkEmailJob_status_nextProcessTime_idx" ON "public"."BulkEmailJob"("status", "nextProcessTime");

-- CreateIndex
CREATE INDEX "BulkEmailJob_tenantId_status_idx" ON "public"."BulkEmailJob"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BulkEmailJobLead_jobId_leadId_key" ON "public"."BulkEmailJobLead"("jobId", "leadId");

-- CreateIndex
CREATE INDEX "CalendarConnection_tenant_idx" ON "public"."CalendarConnection"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_tenant_user_provider_uq" ON "public"."CalendarConnection"("tenantId", "userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLead_campaignId_leadId_key" ON "public"."CampaignLead"("campaignId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "company_profile_tenant_id_key" ON "public"."CompanyProfile"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_company_qa_company_category" ON "public"."CompanyQA"("company_id", "category");

-- CreateIndex
CREATE INDEX "conversation_tenant_lastMessageAt_idx" ON "public"."Conversation"("tenantId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_tenant_threadkey_uq" ON "public"."Conversation"("tenantId", "threadKey");

-- CreateIndex
CREATE INDEX "idx_CsvImportJob_tenantId_status" ON "public"."CsvImportJob"("tenantId", "status");

-- CreateIndex
CREATE INDEX "idx_CsvImportRow_jobId_rowNumber" ON "public"."CsvImportRow"("jobId", "rowNumber");

-- CreateIndex
CREATE INDEX "idx_CsvImportRow_jobId_status" ON "public"."CsvImportRow"("jobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DomainIdentity_domainName_key" ON "public"."DomainIdentity"("domainName");

-- CreateIndex
CREATE UNIQUE INDEX "EmailEvent_snsMessageId_key" ON "public"."EmailEvent"("snsMessageId");

-- CreateIndex
CREATE INDEX "idx_emailevent_bounce_type" ON "public"."EmailEvent"("bounceType");

-- CreateIndex
CREATE INDEX "idx_emailevent_complaint_type" ON "public"."EmailEvent"("complaintType");

-- CreateIndex
CREATE INDEX "idx_emailevent_emailmessage" ON "public"."EmailEvent"("emailMessageId");

-- CreateIndex
CREATE INDEX "idx_emailevent_provider" ON "public"."EmailEvent"("providerMessageId");

-- CreateIndex
CREATE INDEX "idx_emailevent_recipient_domain" ON "public"."EmailEvent"("recipientDomain");

-- CreateIndex
CREATE INDEX "idx_emailevent_tenant_eventtype" ON "public"."EmailEvent"("tenantId", "eventType");

-- CreateIndex
CREATE INDEX "idx_emailevent_tenant_time" ON "public"."EmailEvent"("tenantId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailIdentity_emailAddress_key" ON "public"."EmailIdentity"("emailAddress");

-- CreateIndex
CREATE INDEX "emailmessage_tenant_conv_createdAt_idx" ON "public"."EmailMessage"("tenantId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "emailmessage_tenant_inReplyTo_idx" ON "public"."EmailMessage"("tenantId", "inReplyTo");

-- CreateIndex
CREATE UNIQUE INDEX "emailmessage_tenant_providerMessageId_uq" ON "public"."EmailMessage"("tenantId", "providerMessageId");

-- CreateIndex
CREATE INDEX "idx_feedback_tenant_category" ON "public"."Feedback"("tenant_id", "category");

-- CreateIndex
CREATE INDEX "idx_feedback_tenant_created_at" ON "public"."Feedback"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "InboundReceipt_snsMessageId_key" ON "public"."InboundReceipt"("snsMessageId");

-- CreateIndex
CREATE INDEX "inboundreceipt_tenant_receivedAt_idx" ON "public"."InboundReceipt"("tenantId", "receivedAt");

-- CreateIndex
CREATE INDEX "idx_knowledge_document_status" ON "public"."KnowledgeDocument"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_linkedInUrl_key" ON "public"."Lead"("linkedInUrl");

-- CreateIndex
CREATE INDEX "Lead_jobId_idx" ON "public"."Lead"("jobId");

-- CreateIndex
CREATE INDEX "Lead_tenantId_status_idx" ON "public"."Lead"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_jobId_email_key" ON "public"."Lead"("jobId", "contactEmail");

-- CreateIndex
CREATE INDEX "LeadGenerationJob_tenantId_status_idx" ON "public"."LeadGenerationJob"("tenantId", "status");

-- CreateIndex
CREATE INDEX "MeetingBooking_intent_idx" ON "public"."MeetingBooking"("intentId");

-- CreateIndex
CREATE INDEX "MeetingIntent_tenant_conversation_idx" ON "public"."MeetingIntent"("tenantId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingOffer_unique_slot_per_intent" ON "public"."MeetingOffer"("intentId", "slotStart", "slotEnd");

-- CreateIndex
CREATE UNIQUE INDEX "paymenttransaction_providerid_unique" ON "public"."PaymentTransaction"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "public"."Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PlanVersion_planId_zone_bucket_cadence_version_key" ON "public"."PlanVersion"("planId", "zone", "bucket", "cadence", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PriceId_planVersionId_gateway_key" ON "public"."PriceId"("planVersionId", "gateway");

-- CreateIndex
CREATE INDEX "idx_tenant_rag_tenant_id" ON "public"."TenantRAG"("tenant_id");

-- CreateIndex
CREATE INDEX "tenantrag_active_updated_idx" ON "public"."TenantRAG"("tenant_id", "is_active", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "tenantrag_source_idx" ON "public"."TenantRAG"("tenant_id", "source");

-- CreateIndex
CREATE UNIQUE INDEX "tenantrag_tenant_hash_uq" ON "public"."TenantRAG"("tenant_id", "chunk_hash");

-- CreateIndex
CREATE INDEX "UsageCounter_lookup_idx" ON "public"."UsageCounter"("tenantId", "metric", "windowType", "windowStart");

-- CreateIndex
CREATE INDEX "UsageEvent_tenantId_recordedAt_idx" ON "public"."UsageEvent"("tenantId", "recordedAt");

-- CreateIndex
CREATE INDEX "UsageEvent_tenant_recordedAt_idx" ON "public"."UsageEvent"("tenantId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "wait_list_members_email_key" ON "public"."WaitListMembers"("email");

-- CreateIndex
CREATE INDEX "idx_website_content_status" ON "public"."WebsiteContent"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "idx_emailverification_tenant_status" ON "public"."EmailVerification"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "emailverification_tenant_email_uq" ON "public"."EmailVerification"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "EmailWarmupProfile_emailIdentityId_key" ON "public"."EmailWarmupProfile"("emailIdentityId");

-- CreateIndex
CREATE INDEX "idx_warmup_profile_tenant_status" ON "public"."EmailWarmupProfile"("tenantId", "status");

-- CreateIndex
CREATE INDEX "idx_warmup_daily_tenant_date" ON "public"."WarmupDailyStat"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "warmup_daily_identity_date_uq" ON "public"."WarmupDailyStat"("tenantId", "emailIdentityId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "WarmupInbox_email_key" ON "public"."WarmupInbox"("email");

-- CreateIndex
CREATE INDEX "idx_warmup_inbox_event_tenant_time" ON "public"."WarmupInboxEvent"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "idx_warmup_inbox_event_time" ON "public"."WarmupInboxEvent"("warmupInboxId", "occurredAt");

-- CreateIndex
CREATE INDEX "idx_warmupmessage_tenant_time" ON "public"."WarmupMessage"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "warmupmessage_tenant_providerMessageId_uq" ON "public"."WarmupMessage"("tenantId", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "WarmupMessageEvent_snsMessageId_key" ON "public"."WarmupMessageEvent"("snsMessageId");

-- CreateIndex
CREATE INDEX "idx_warmupmessageevent_message" ON "public"."WarmupMessageEvent"("warmupMessageId");

-- CreateIndex
CREATE INDEX "idx_warmupmessageevent_tenant_time" ON "public"."WarmupMessageEvent"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "idx_warmupthread_tenant_profile_time" ON "public"."WarmupThread"("tenantId", "profileId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "warmupthread_tenant_threadkey_uq" ON "public"."WarmupThread"("tenantId", "threadKey");

-- AddForeignKey
ALTER TABLE "public"."BulkEmailJob" ADD CONSTRAINT "BulkEmailJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."EmailCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BulkEmailJob" ADD CONSTRAINT "BulkEmailJob_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."EmailTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BulkEmailJob" ADD CONSTRAINT "BulkEmailJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BulkEmailJobLead" ADD CONSTRAINT "BulkEmailJobLead_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."BulkEmailJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BulkEmailJobLead" ADD CONSTRAINT "BulkEmailJobLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BulkSnippet" ADD CONSTRAINT "bulk_snippet_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."CalendarConnection" ADD CONSTRAINT "CalendarConnection_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."CalendarConnection" ADD CONSTRAINT "CalendarConnection_user_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."CampaignLead" ADD CONSTRAINT "CampaignLead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."EmailCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignLead" ADD CONSTRAINT "CampaignLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CompanyProfile" ADD CONSTRAINT "company_profile_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."CompanyQA" ADD CONSTRAINT "company_qa_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."CompanyProfile"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."Component" ADD CONSTRAINT "Component_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "public"."PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "conversation_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."CsvImportRow" ADD CONSTRAINT "fk_CsvImportRow_jobId" FOREIGN KEY ("jobId") REFERENCES "public"."CsvImportJob"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."DomainIdentity" ADD CONSTRAINT "DomainIdentity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailCampaign" ADD CONSTRAINT "EmailCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."EmailTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailCampaign" ADD CONSTRAINT "EmailCampaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailEvent" ADD CONSTRAINT "EmailEvent_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "public"."EmailMessage"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."EmailIdentity" ADD CONSTRAINT "EmailIdentity_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "public"."DomainIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailMessage" ADD CONSTRAINT "emailmessage_campaign_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."EmailCampaign"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."EmailMessage" ADD CONSTRAINT "emailmessage_conversation_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."EmailMessage" ADD CONSTRAINT "emailmessage_lead_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."EmailMessage" ADD CONSTRAINT "emailmessage_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."EmailTemplate" ADD CONSTRAINT "EmailTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Feedback" ADD CONSTRAINT "fk_feedback_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."GeneratedEmail" ADD CONSTRAINT "GeneratedEmail_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "public"."EmailMessage"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."InboundReceipt" ADD CONSTRAINT "inboundreceipt_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."KnowledgeDocument" ADD CONSTRAINT "knowledge_document_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."Lead" ADD CONSTRAINT "Lead_csvJobId_fkey" FOREIGN KEY ("csvJobId") REFERENCES "public"."CsvImportJob"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."Lead" ADD CONSTRAINT "Lead_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."LeadGenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Lead" ADD CONSTRAINT "Lead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeadGenerationJob" ADD CONSTRAINT "LeadGenerationJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MeetingBooking" ADD CONSTRAINT "MeetingBooking_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "public"."MeetingIntent"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."MeetingOffer" ADD CONSTRAINT "MeetingOffer_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "public"."MeetingIntent"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."PaymentTransaction" ADD CONSTRAINT "fk_paymenttransaction_subscription" FOREIGN KEY ("subscriptionId") REFERENCES "public"."Subscription"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."PaymentTransaction" ADD CONSTRAINT "fk_paymenttransaction_tenant" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."PlanVersion" ADD CONSTRAINT "PlanVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PriceId" ADD CONSTRAINT "PriceId_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "public"."PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Product" ADD CONSTRAINT "product_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."CompanyProfile"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."ProductQA" ADD CONSTRAINT "product_qa_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."RagReadiness" ADD CONSTRAINT "RagReadiness_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."TenantOnboarding" ADD CONSTRAINT "TenantOnboarding_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."UsageCounter" ADD CONSTRAINT "UsageCounter_subscription_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."Subscription"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."UsageCounter" ADD CONSTRAINT "UsageCounter_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."UsageEvent" ADD CONSTRAINT "UsageEvent_subscription_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."Subscription"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."UsageEvent" ADD CONSTRAINT "UsageEvent_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Variable" ADD CONSTRAINT "Variable_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."EmailTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WebsiteContent" ADD CONSTRAINT "website_content_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."EmailVerification" ADD CONSTRAINT "fk_emailverification_lead" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."EmailVerification" ADD CONSTRAINT "fk_emailverification_tenant" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."EmailWarmupProfile" ADD CONSTRAINT "fk_warmup_profile_identity" FOREIGN KEY ("emailIdentityId") REFERENCES "public"."EmailIdentity"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."EmailWarmupProfile" ADD CONSTRAINT "fk_warmup_profile_tenant" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."WarmupDailyStat" ADD CONSTRAINT "fk_warmup_daily_identity" FOREIGN KEY ("emailIdentityId") REFERENCES "public"."EmailIdentity"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."WarmupDailyStat" ADD CONSTRAINT "fk_warmup_daily_tenant" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."WarmupInbox" ADD CONSTRAINT "fk_warmup_inbox_owner" FOREIGN KEY ("ownerTenantId") REFERENCES "public"."Tenant"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."WarmupInboxEvent" ADD CONSTRAINT "fk_warmup_event_inbox" FOREIGN KEY ("warmupInboxId") REFERENCES "public"."WarmupInbox"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."WarmupInboxEvent" ADD CONSTRAINT "fk_warmup_event_message" FOREIGN KEY ("emailMessageId") REFERENCES "public"."EmailMessage"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."WarmupMessage" ADD CONSTRAINT "WarmupMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "public"."WarmupThread"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."WarmupMessageEvent" ADD CONSTRAINT "WarmupMessageEvent_warmupMessageId_fkey" FOREIGN KEY ("warmupMessageId") REFERENCES "public"."WarmupMessage"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."WarmupThread" ADD CONSTRAINT "WarmupThread_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "public"."WarmupInbox"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."WarmupThread" ADD CONSTRAINT "WarmupThread_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "public"."EmailWarmupProfile"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
