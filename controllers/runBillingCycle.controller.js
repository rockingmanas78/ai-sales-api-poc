// scripts/runBillingCycle.js
import { PrismaClient } from '@prisma/client';
import { calculateTax } from '../utils/calculateTax.js';
//import { payments } from '../libs/payments/index.js';
import { addMonths } from 'date-fns';
import { fetchUsageTotals } from '../utils/fetchUsageTotals.js';
import { rate } from '../utils/rate.js';
import { latestPlanVersionId } from '../utils/latestPlanVersionId.js';

const prisma = new PrismaClient();

export async function runBillingCycle() {
  const dueSubs = await prisma.subscription.findMany({
    where: {
      status: 'ACTIVE',
      currentEnd: { lte: new Date() }
    },
    include: {
      tenant: true,
      planVersion: {
        include: { components: true }
      },
      broker: true,
      gatewaySubs: true
    }
  });

  for (const sub of dueSubs) {
    await prisma.$transaction(async (tx) => {
      const usage = await fetchUsageTotals(tx, sub); // e.g. { JOB, CLASSIFICATION }
      const seats = await tx.user.count({
        where: { tenantId: sub.tenantId, deletedAt: null }
      });

      const { lines, subtotal } = rate(
        usage,
        seats,
        sub.planVersion.components,
        sub.planVersion.basePriceCents
      );

      const { taxable, tax } = await calculateTax(subtotal, sub.tenant.countryCode);

      const invoice = await tx.invoice.create({
        data: {
          subscriptionId: sub.id,
          subtotalCents: subtotal,
          taxCents: tax,
          totalCents: taxable + tax,
          lines: { createMany: { data: lines } }
        }
      });

      await payments.chargeInvoice(invoice, sub.gatewaySubs[0]);

      if (sub.brokerId) {
        const comm = Math.round(taxable * sub.broker.commissionRate / 100);
        await tx.brokerLedger.create({
          data: {
            brokerId: sub.brokerId,
            invoiceId: invoice.id,
            commissionCents: comm
          }
        });
      }

      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          currentStart: sub.currentEnd,
          //do for yearly billing as well
          currentEnd: addMonths(sub.currentEnd, 1),
          planVersionId: await latestPlanVersionId(sub.planVersion.planId, sub.zone)
        }
      });
    });
  }
}
