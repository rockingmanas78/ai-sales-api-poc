// controllers/userController.js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import bcrypt from 'bcryptjs';
// CREATE a new User
export const createUser = async (req, res) => {
  try {

    const {tenantId} = req.user;

    const { email, password, role = 'MANAGER', verified = false } = req.body;

    if (!tenantId || !email || !password) {
      return res.status(400).json({ error: 'tenantId, email, and passwordHash are required' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser && !existingUser.deletedAt) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);;

    const newUser = await prisma.user.create({
      data: {
        tenantId,
        email,
        passwordHash : hashedPassword,
        role,
        verified,
      },
    });

    res.status(201).json(newUser);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET all active users for a tenant
export const getUsers = async (req, res) => {
  try {

    const { tenantId } = req.user;
    
    // if (!tenantId) {
    //   return res.status(400).json({ error: 'tenantId is required in query' });
    // }

    const users = await prisma.user.findMany({
      where: {
        tenantId,
        deletedAt: null,
      },
    });

    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET single user by ID and tenant
export const getUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    const { tenantId } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required in request body' });
    }

    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found or does not belong to the tenant' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// UPDATE user by ID and tenant
export const updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { tenantId } = req.user;
    const {  ...updates } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required in request body' });
    }

    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found or does not belong to the tenant' });
    }

    if ('deletedAt' in updates) delete updates.deletedAt;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updates,
    });

    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// DELETE user by ID and tenant (soft delete)
export const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { tenantId } = req.user;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required in request body' });
    }

    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found or does not belong to the tenant' });
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
      },
    });

    res.json({ message: 'User soft deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
