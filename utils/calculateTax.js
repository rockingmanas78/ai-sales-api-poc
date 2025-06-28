import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

/**
 * Calculates tax for a given subtotal and country.
 * @param {number} subtotal - Amount before tax
 * @param {string} country - ISO country code (e.g., "IN", "US")
 * @returns {Promise<{ taxable: number, tax: number }>}
 */
export async function calculateTax(subtotal, country) {
  const cfg = await prisma.countryTaxRate.findUnique({
    where: { countryCode: country }
  });

  if (!cfg) {
    return { taxable: subtotal, tax: 0 };
  }

  if (cfg.inclusive) {
    const taxable = Math.round(subtotal / (1 + cfg.ratePct / 100));
    return {
      taxable,
      tax: subtotal - taxable
    };
  }

  const tax = Math.round(subtotal * cfg.ratePct / 100);
  return {
    taxable: subtotal,
    tax
  };
}
