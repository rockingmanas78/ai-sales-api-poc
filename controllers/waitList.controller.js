import prisma from '../utils/prisma.client.js';

export const createWaitListMember = async (req, res) => {
  try {
    const { name, email, whatsapp_number } = req.body;

    // Basic validation
    if (!name || !email || !whatsapp_number) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Create entry
    const newMember = await prisma.waitListMembers.create({
      data: {
        name,
        email,
        whatsapp_number,
      },
    });

    res.status(201).json({ message: 'Waitlist member created successfully', member: newMember });
  } catch (error) {
    console.error('Error creating waitlist member:', error);
    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Email already exists' });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
};
