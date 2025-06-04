import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateTokens } from '../utils/generateTokens.js';

const prisma = new PrismaClient();

// POST /tenant/create
export const createTenant = async (req, res) => {
  try {
    const { name, plan = 'FREE', email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [tenant, user] = await prisma.$transaction(async (tx) => {
      const newTenant = await tx.tenant.create({
        data: {
          name,
          plan,
        },
      });

      const role = "ADMIN";

      const newUser = await tx.user.create({
        data: {
          email,
          passwordHash: hashedPassword,
          tenantId: newTenant.id,
          role,
        },
      });

      return [newTenant, newUser];
    });

    const token = generateTokens(user);
    const { passwordHash, ...userWithoutPassword } = user;

    res.status(201).json({ user: userWithoutPassword, tenant, token });
  } catch (error) {
    console.error('Error creating tenant and user:', error);
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
