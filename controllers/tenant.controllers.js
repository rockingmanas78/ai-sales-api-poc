import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateTokens } from '../utils/generateTokens.js';

const prisma = new PrismaClient();

// POST /tenant/create
// controllers/auth/register.js

import { addMonths } from 'date-fns';
import { mapCountryToZone } from '../middlewares/geo-detect.js';
//import payments from '../../libs/payments/index.js';



export const createTenant = async (req, res) => {
  try {
    const { name, email, password, planCode = 'FREE' } = req.body;
    const countryCode=req.headers["x-user-zone"];

    if (!name || !email || !password || !countryCode) {
      return res.status(400).json({ message: 'Name, email, password, and countryCode are required' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const zone = mapCountryToZone(countryCode);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create tenant
      const tenant = await tx.tenant.create({
        data: {
          name,
          plan: planCode,
          countryCode,
          zone,
        },
      });

      // 2. Pick latest public plan version
      const planVersion = await tx.planVersion.findFirstOrThrow({
        where: {
          plan: { code: planCode },
          zone,
          bucket: 'PUBLIC',
          cadence: 'MONTHLY',
        },
        orderBy: { version: 'desc' },
        include: { prices: true },
      });

      // 3. Create subscription
      const subscription = await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planVersionId: planVersion.id,
          zone,
          status: 'ACTIVE',
          currentStart: new Date(),
          currentEnd: addMonths(new Date(), 1),
        },
      });

      // 4. Create user with ADMIN role
      const user = await tx.user.create({
        data: {
          email,
          passwordHash: hashedPassword,
          tenantId: tenant.id,
          role: 'ADMIN',
        },
      });

      return { tenant, user, planVersion };
    });

    const { tenant, user, planVersion } = result;
    const token = generateTokens(user);
    const { passwordHash, ...userWithoutPassword } = user;

    // let paymentInfo = null;
    // if (planVersion.prices.length > 0) {
    //   const gwResp = await payments.createGatewaySubscription(planVersion.prices[0].externalPriceId, tenant);
    //   paymentInfo = { clientSecret: gwResp.clientSecret };
    // }

    res.status(201).json({ user: userWithoutPassword, tenant, token, paymentInfo });
  } catch (error) {
    console.error('Error in registerUserAndTenant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};


// GET /tenant/all
export const getAllTenant = async (req, res) => {
  try {
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        plan: true,
        createdAt: true,
        users: {
          select: { id: true, email: true },
        },
        leads: { select: { id: true } },
        templates: { select: { id: true } },
        campaigns: { select: { id: true } },
        jobs: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(tenants);
  } catch (error) {
    console.error('Error fetching tenants:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /tenant/profile/:tenantId
export const getTenantProfile = async (req, res) => {
  const { tenantId } = req.params;

  try {
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      include: {
        users: true,
        leads: true,
        templates: true,
        campaigns: true,
        jobs: true,
      },
    });

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found or deleted' });
    }

    res.json(tenant);
  } catch (error) {
    console.error('Error fetching tenant profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// PATCH /tenant/update/:tenantId
export const updateTenantProfile = async (req, res) => {
  const { tenantId } = req.params;
  const updates = req.body;

  try {
    const existing = await prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Tenant not found or deleted' });
    }

    if ('deletedAt' in updates) {
      delete updates.deletedAt;
    }

    const updatedTenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: updates,
    });

    res.json(updatedTenant);
  } catch (error) {
    console.error('Error updating tenant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// DELETE /tenant/delete/:tenantId (soft delete)
export const softDeleteTenant = async (req, res) => {
  const { tenantId } = req.params;

  try {
    const existing = await prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Tenant not found or already deleted' });
    }

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { deletedAt: new Date() },
    });

    res.json({ message: 'Tenant soft deleted successfully' });
  } catch (error) {
    console.error('Error soft deleting tenant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /tenant/plans
export const getAvailablePlans = async (req, res) => {
  const plans = [
    { tier: 'FREE', price: 0, description: 'Free tier with limited features' },
    { tier: 'PRO', price: 49, description: 'Advanced features for growing teams' },
    { tier: 'ENTERPRISE', price: 199, description: 'Full feature set with premium support' },
  ];

  res.json(plans);
};
