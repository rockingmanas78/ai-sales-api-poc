import prisma from '../utils/prisma.client.js';

// POST /api/websites - Add a new website for crawling
export const createWebsite = async (req, res) => {
  const { url } = req.body;
  const tenantId = req.user?.tenantId;

  if (!tenantId || !url) {
    return res.status(400).json({ message: 'Missing tenant ID or URL' });
  }

  try {
    const newSite = await prisma.websiteContent.create({
      data: {
        tenant_id: tenantId,
        url,
        status: 'PENDING',
      },
    });

    res.status(201).json(newSite);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create website record', error: err.message });
  }
};

// GET /api/websites - List websites by tenant
export const listWebsites = async (req, res) => {
  const tenantId = req.user?.tenantId;

  try {
    const websites = await prisma.websiteContent.findMany({
      where: { tenant_id: tenantId },
      orderBy: { added_at: 'desc' },
    });

    res.status(200).json(websites);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch websites', error: err.message });
  }
};

// GET /api/websites/:id - Get specific website
export const getWebsiteById = async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user?.tenantId;

  try {
    const site = await prisma.websiteContent.findFirst({
      where: { id, tenant_id: tenantId },
    });

    if (!site) {
      return res.status(404).json({ message: 'Website not found or access denied' });
    }

    res.status(200).json(site);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching website', error: err.message });
  }
};

// PATCH /api/websites/:id - Update URL or reset crawl status
export const updateWebsite = async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user?.tenantId;
  const { url, status } = req.body;

  try {
    const existing = await prisma.websiteContent.findFirst({
      where: { id, tenant_id: tenantId },
    });

    if (!existing) {
      return res.status(404).json({ message: 'Website not found or access denied' });
    }

    const updated = await prisma.websiteContent.update({
      where: { id },
      data: {
        ...(url && { url }),
        ...(status && { status }),
      },
    });

    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update website', error: err.message });
  }
};

// DELETE /api/websites/:id - Remove a crawl entry
export const deleteWebsite = async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user?.tenantId;

  try {
    const existing = await prisma.websiteContent.findFirst({
      where: { id, tenant_id: tenantId },
    });

    if (!existing) {
      return res.status(404).json({ message: 'Website not found or access denied' });
    }

    await prisma.websiteContent.delete({ where: { id } });

    res.status(200).json({ message: 'Website and related data deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete website', error: err.message });
  }
};
