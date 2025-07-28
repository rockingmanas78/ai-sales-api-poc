import prisma from '../utils/prisma.client.js';

// GET: Fetch current tenant’s onboarding data
export const getTenantOnboarding = async (req, res) => {
  const tenantId = req.user?.tenantId;

  try {
    const onboarding = await prisma.tenantOnboarding.findUnique({
      where: { tenant_id: tenantId },
    });

    if (!onboarding) {
      return res.status(404).json({ message: 'Onboarding data not found' });
    }

    return res.status(200).json(onboarding);
  } catch (error) {
    console.error('GET onboarding error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// POST: Create/complete onboarding survey (upsert behavior)
export const createOrUpdateTenantOnboarding = async (req, res) => {
  try {
    const { role, hear_about_us, primary_goal } = req.body;
    const tenantId = req.user.tenantId;

    if (!tenantId) {
      return res.status(400).json({ message: 'Tenant ID missing from token' });
    }
    const updatedAt= new Date();
    const onboarding = await prisma.tenantOnboarding.upsert({
      where: { tenant_id: tenantId },
      update: {
        role,
        hear_about_us,
        primary_goal,
        updated_at: updatedAt
      },
      create: {
        tenant_id: tenantId,
        role,
        hear_about_us,
        primary_goal,
      },
    });

    res.status(200).json({ message: 'Onboarding saved', onboarding });
  } catch (error) {
    console.error('Onboarding error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
// PATCH: Update one or more onboarding fields
export const updateTenantOnboarding = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;
    const { role, hear_about_us, primary_goal } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id from token' });
    }
    const updatedAt= new Date();
    const updated = await prisma.tenantOnboarding.upsert({
  where: { tenant_id: tenantId },
  update: {
    role,
    hear_about_us,
    primary_goal,
    updated_at: updatedAt
  },
  create: {
    tenant_id: tenantId,
    role,
    hear_about_us,
    primary_goal
  }
});

return res.status(200).json({ message: 'Onboarding updated', updated });

  } catch (error) {
    console.error('[UPDATE_ONBOARDING_ERROR]', error);

    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Tenant onboarding record not found' });
    }

    return res.status(500).json({ error: 'Something went wrong' });
  }
};
