/*
  Warnings:

  - The values [ENTERPRISE] on the enum `PlanType` will be removed. If these variants are still used in the database, this will fail.
  - The `contactEmail` column on the `Lead` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `contactPhone` column on the `Lead` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `campaign_type` to the `EmailCampaign` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `EmailCampaign` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalRequested` to the `LeadGenerationJob` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `price` on the `PriceId` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('COLD_OUTREACH', 'FOLLOW_UP_SEQUENCE', 'LEAD_NURTURING', 'RE_ENGAGEMENT');

-- CreateEnum
CREATE TYPE "lead_source" AS ENUM ('AI_GENERATED', 'CSV_UPLOAD', 'MANUAL_ENTRY');

-- CreateEnum
CREATE TYPE "crawl_status" AS ENUM ('PENDING', 'CRAWLING', 'READY', 'ERROR');

-- CreateEnum
CREATE TYPE "document_status" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'ERROR');

-- AlterEnum
BEGIN;
CREATE TYPE "PlanType_new" AS ENUM ('FREE', 'PRO', 'GROWTH', 'STARTER');
ALTER TABLE "Tenant" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "Tenant" ALTER COLUMN "plan" TYPE "PlanType_new" USING ("plan"::text::"PlanType_new");
ALTER TYPE "PlanType" RENAME TO "PlanType_old";
ALTER TYPE "PlanType_new" RENAME TO "PlanType";
DROP TYPE "PlanType_old";
ALTER TABLE "Tenant" ALTER COLUMN "plan" SET DEFAULT 'FREE';
COMMIT;

-- AlterTable
ALTER TABLE "DomainIdentity" ADD COLUMN     "dkimRecords" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "EmailCampaign" ADD COLUMN     "campaign_type" "CampaignType" NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "name" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "contactAddress" TEXT[],
ADD COLUMN     "source" "lead_source" NOT NULL DEFAULT 'AI_GENERATED',
DROP COLUMN "contactEmail",
ADD COLUMN     "contactEmail" TEXT[],
ALTER COLUMN "contactName" DROP NOT NULL,
DROP COLUMN "contactPhone",
ADD COLUMN     "contactPhone" TEXT[];

-- AlterTable
ALTER TABLE "LeadGenerationJob" ADD COLUMN     "generatedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalRequested" INTEGER NOT NULL,
ADD COLUMN     "urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "prompt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PriceId" DROP COLUMN "price",
ADD COLUMN     "price" INTEGER NOT NULL;

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

-- CreateIndex
CREATE UNIQUE INDEX "company_profile_tenant_id_key" ON "CompanyProfile"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_company_qa_company_category" ON "CompanyQA"("company_id", "category");

-- CreateIndex
CREATE INDEX "idx_knowledge_document_status" ON "KnowledgeDocument"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "idx_website_content_status" ON "WebsiteContent"("tenant_id", "status");

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
