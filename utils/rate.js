import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export function rate(usage, seats, components, basePrice = 0) {
  let subtotal = basePrice;
  const lines = [];

  for (const comp of components) {
    const qty = comp.metric === 'SEAT' ? seats : (usage[comp.metric] || 0);
    const price = comp.overageCents * qty;

    if (qty > 0) {
      lines.push({
        metric: comp.metric,
        qty,
        priceCents: comp.overageCents,
        subtotalCents: price
      });
      subtotal += price;
    }
  }

  return { lines, subtotal };
}