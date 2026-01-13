import { PrismaClient } from "@prisma/client";
import { registerWarmupSubdomainInSes } from "../services/warmup.dns.service.js";

const prisma = new PrismaClient();

/**
 * List active warmup inboxes
 */
export async function listWarmupInboxes(req, res) {
  try {
    const inboxes = await prisma.warmupInbox.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        email: true,
        provider: true,
        domain: true,
        status: true,
        createdAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      data: inboxes,
    });
  } catch (error) {
    console.error("[listWarmupInboxes] error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch warmup inboxes",
    });
  }
}

/**
 * Create warmup inbox
 * ⚠️ Should be ADMIN / SYSTEM only
 */
export async function createWarmupInbox(req, res) {
  try {
    const { tenantId, email, provider, domain } = req.body;

    const [local, rootDomain] = email.split('@');
    const warmupEmail = `${local}@warmup.${rootDomain}`;

    if (!tenantId || !email || !provider) {
      return res.status(400).json({
        success: false,
        error: "tenantId, email and provider are required",
      });
    }

    const inbox = await prisma.warmupInbox.create({
      data: {
        ownerTenantId: tenantId,
        email: warmupEmail,
        provider,
        domain: `warmup.${rootDomain}`, // Tracking will now happen here
        status: "ACTIVE",
      },
    });

    return res.status(201).json({
      success: true,
      data: inbox,
    });
  } catch (error) {
    console.error("[createWarmupInbox] error:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to create warmup inbox",
    });
  }
}

/**
 * Update warmup inbox
 * (pause, resume, provider change, etc.)
 */
export async function updateWarmupInbox(req, res) {
  try {
    const { id } = req.params;
    const { status, provider } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "WarmupInbox id is required",
      });
    }

    if (status && !["ACTIVE", "PAUSED"].includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status. Allowed: ACTIVE, PAUSED",
      });
    }

    const inbox = await prisma.warmupInbox.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(provider && { provider }),
      },
    });

    return res.status(200).json({
      success: true,
      data: inbox,
    });
  } catch (error) {
    console.error("[updateWarmupInbox] error:", error);

    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        error: "Warmup inbox not found",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to update warmup inbox",
    });
  }
}

/**
 * POST /api/warmup/inbox/onboard
 * Single step: Registers subdomain in SES + Creates WarmupInbox DB entry
 */
export async function onboardWarmupInbox(req, res) {
  try {
    const { tenantId, rootDomain, localPart = "warmup-sender" } = req.body;

    if (!tenantId || !rootDomain) {
      return res.status(400).json({ error: "tenantId and rootDomain are required" });
    }

    const subdomain = `warmup.${rootDomain}`;
    const email = `${localPart}@${subdomain}`;

    // 1. Transactional Block
    const result = await prisma.$transaction(async (tx) => {
      
      // 2. Check for existing domain inside the transaction
      let domainIdentity = await tx.domainIdentity.findFirst({
        where: { domainName: subdomain, tenantId },
      });

      let dnsInstructions = [];

      if (!domainIdentity) {
        // 3. Call SES Service (External API call)
        // Note: External API calls can't be "rolled back" by SQL, 
        // but the DB record creation will be.
        const sesResult = await registerWarmupSubdomainInSes(subdomain);
        dnsInstructions = sesResult.dnsRecords;

        // 4. Create DomainIdentity using transaction client 'tx'
        domainIdentity = await tx.domainIdentity.create({
          data: {
            tenantId,
            domainName: subdomain,
            verificationToken: sesResult.verificationToken,
            verificationStatus: "Pending",
            dkimRecords: dnsInstructions,
          },
        });
      } else {
        dnsInstructions = domainIdentity.dkimRecords;
      }

      // 5. Upsert WarmupInbox using transaction client 'tx'
      const inbox = await tx.warmupInbox.upsert({
        where: { email },
        update: { status: "ACTIVE" },
        create: {
          ownerTenantId: tenantId, // Using the correct schema field name
          email,
          domain: subdomain,
          provider: "AWS_SES",
          status: "ACTIVE",
          autoEngagementEnabled: true,
        },
      });

      return { inbox, domainIdentity, dnsInstructions };
    });

    // If we reach here, everything succeeded and was committed
    return res.status(201).json({
      success: true,
      message: "Warmup Inbox & Subdomain initialized successfully.",
      data: {
        inbox: result.inbox,
        subdomain: result.domainIdentity,
        dnsRecords: result.dnsInstructions 
      },
    });

  } catch (error) {
    // If any step inside the transaction fails, Prisma automatically rolls back
    console.error("[onboardWarmupInbox] Transaction failed:", error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || "An error occurred during onboarding." 
    });
  }
}