import prisma from '../utils/prisma.client.js';

// CREATE a new bulk snippet
export const createSnippet = async (req, res) => {
  try {
    const { content, category } = req.body;
    const tenantId = req.user.tenantId;

    const snippet = await prisma.bulkSnippet.create({
      data: {
        content,
        category,
        tenantId,
      },
    });

    res.status(201).json({ message: 'Snippet created successfully', snippet });
  } catch (error) {
    console.error('Error creating snippet:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// GET all snippets (with optional pagination and filtering)
export const listSnippets = async (req, res) => {
  try {
    const tenantId = req.user.tenantId;

    const snippets = await prisma.bulkSnippet.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json(snippets);
  } catch (error) {
    console.error('Error fetching snippets:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// GET one snippet by ID
export const getSnippetById = async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenantId;

    const snippet = await prisma.bulkSnippet.findUnique({
      where: { id },
    });

    if (!snippet || snippet.tenantId !== tenantId) {
      return res.status(404).json({ message: 'Snippet not found' });
    }

    res.status(200).json(snippet);
  } catch (error) {
    console.error('Error fetching snippet:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// UPDATE a snippet's content or category
export const updateSnippet = async (req, res) => {
  try {
    const { id } = req.params;
    const { content, category } = req.body;
    const tenantId = req.user.tenantId;

    const existingSnippet = await prisma.bulkSnippet.findUnique({ where: { id } });

    if (!existingSnippet || existingSnippet.tenantId !== tenantId) {
      return res.status(404).json({ message: 'Snippet not found' });
    }

    const updated = await prisma.bulkSnippet.update({
      where: { id },
      data: { content, category },
    });

    res.status(200).json({ message: 'Snippet updated successfully', updated });
  } catch (error) {
    console.error('Error updating snippet:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// DELETE a snippet
export const deleteSnippet = async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenantId;

    const existingSnippet = await prisma.bulkSnippet.findUnique({ where: { id } });

    if (!existingSnippet || existingSnippet.tenantId !== tenantId) {
      return res.status(404).json({ message: 'Snippet not found' });
    }

    await prisma.bulkSnippet.delete({ where: { id } });

    res.status(200).json({ message: 'Snippet deleted successfully' });
  } catch (error) {
    console.error('Error deleting snippet:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
