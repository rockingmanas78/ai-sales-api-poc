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
  const tenantId = req.user?.tenantId;
  const { role, hear_about_us, primary_goal } = req.body;

  try {
    const onboarding = await prisma.tenantOnboarding.upsert({
      where: { tenant_id: tenantId },
      update: { role, hear_about_us, primary_goal, updated_at: new Date() },
      create: {
        tenant_id: tenantId,
        role,
        hear_about_us,
        primary_goal,
      },
    });

    return res.status(200).json({ message: 'Onboarding saved', onboarding });
  } catch (error) {
    console.error('POST onboarding error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// PATCH: Update one or more onboarding fields
export const updateTenantOnboarding = async (req, res) => {
  const tenantId = req.user?.tenantId;

  try {
    const onboarding = await prisma.tenantOnboarding.update({
      where: { tenant_id: tenantId },
      data: {
        ...req.body,
        updated_at: new Date(),
      },
    });

    return res.status(200).json({ message: 'Onboarding updated', onboarding });
  } catch (error) {
    console.error('PATCH onboarding error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
