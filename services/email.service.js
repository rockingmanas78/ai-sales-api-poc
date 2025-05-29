import prisma from '../utils/prisma.client.js';

export async function queueEmail({ to, from, subject, body }) {
    // queue email 
  return prisma.email.create({
    data: { to, from, subject, body }
  });
}

export async function listEmails(filter = {}) {
  return prisma.email.findMany({ where: filter, orderBy: { createdAt: 'desc' } });
}

export async function updateEmailStatus(id, status) {
  return prisma.email.update({ where: { id }, data: { status } });
}