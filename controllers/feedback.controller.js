import prisma from '../utils/prisma.client.js';
import { FeedbackCategory } from '@prisma/client';

export const createFeedback = async (req, res) => {
  try {
    const { name, email, category, rating, page, message } = req.body;
    const tenant_id = req.user.tenantId;

    const feedback = await prisma.feedback.create({
      data: {
        tenant_id,
        name,
        email,
        category,
        rating,
        page,
        message,
      },
    });

    res.status(201).json({ message: 'Feedback submitted', feedback });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
};

export const getAllFeedbacks = async (req, res) => {
  try {
    const tenant_id = req.user.tenantId;

    const feedbacks = await prisma.feedback.findMany({
      where: { tenant_id },
      orderBy: { created_at: 'desc' },
    });

    res.json(feedbacks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve feedbacks' });
  }
};

export const getFeedbackById = async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const tenant_id = req.user.tenantId;

    const feedback = await prisma.feedback.findUnique({
      where: { id: feedbackId },
    });

    if (!feedback || feedback.tenant_id !== tenant_id) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    res.json(feedback);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
};

export const deleteFeedback = async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const tenant_id = req.user.tenantId;

    const feedback = await prisma.feedback.findUnique({
      where: { id: feedbackId },
    });

    if (!feedback || feedback.tenant_id !== tenant_id) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    await prisma.feedback.delete({ where: { id: feedbackId } });

    res.json({ message: 'Feedback deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete feedback' });
  }
};

export const getFeedbackCategories = (req, res) => {
  res.json(Object.values(FeedbackCategory));
};
