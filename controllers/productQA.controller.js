import prisma from '../utils/prisma.client.js'

// GET all QA for a product
export const getAllQA = async (req, res) => {
  const { productId } = req.params
  const qaList = await prisma.productQA.findMany({
    where: { product_id: productId },
  })
  res.json(qaList)
}

// GET one QA
export const getOneQA = async (req, res) => {
  const { qaId } = req.params
  const qa = await prisma.productQA.findUnique({
    where: { id: qaId },
  })
  if (!qa) return res.status(404).json({ error: 'QA not found' })
  res.json(qa)
}

// POST bulk create
export const bulkCreateQA = async (req, res) => {
  const { productId } = req.params
  const data = req.body // Expect array of { question, answer }
  if (!Array.isArray(data)) return res.status(400).json({ error: 'Expected array of QA' })

  const created = await prisma.productQA.createMany({
    data: data.map(q => ({
      product_id: productId,
      question: q.question,
      answer: q.answer,
    })),
  })
  res.status(201).json({count: created.count })
}

// PATCH one QA
export const updateQA = async (req, res) => {
  const { qaId } = req.params
  const updated = await prisma.productQA.update({
    where: { id: qaId },
    data: req.body,
  })
  res.json(updated)
}

// DELETE one QA
export const deleteQA = async (req, res) => {
  const { qaId } = req.params;
  try {
    await prisma.productQA.delete({ where: { id: qaId } });
    res.status(200).json({ message: 'QA deleted successfully' });
  } catch (error) {
    res.status(500).json('Failed to delete QA');
  }
};

