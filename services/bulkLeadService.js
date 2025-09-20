// services/bulkLeadService.js

import axios from 'axios';
import csv from 'csv-parser';
import { PrismaClient, lead_source } from '@prisma/client';

const prisma = new PrismaClient();

// Helper function to parse the CSV stream into an array of rows
const parseCsvStream = (stream) => {
    const rows = [];
    return new Promise((resolve, reject) => {
        stream
            .pipe(csv())
            .on('data', (row) => rows.push(row))
            .on('end', () => resolve(rows))
            .on('error', (error) => reject(error));
    });
};

export async function processBulkLeadCsvWithTransaction(fileUrl, tenantId) {
    let response;
    try {
        response = await axios({
            method: 'get',
            url: fileUrl,
            responseType: 'stream',
        });
    } catch (error) {
        throw new Error(`Failed to download file from URL: ${error.message}`);
    }

    // 1. Parse the entire CSV into an in-memory array first
    const allRows = await parseCsvStream(response.data);

    if (allRows.length === 0) {
        throw new Error("CSV file is empty or could not be read.");
    }
    
    // 2. Pre-transaction validation and data mapping
    const leadsToCreate = [];
    for (let i = 0; i < allRows.length; i++) {
        const row = allRows[i];
        const companyName = row.companyName || row['Company Name'];
        const contactEmail = row.contactEmail || row['Email'];

        if (!companyName || !contactEmail) {
            // If any row is invalid, fail the entire operation before starting the transaction
            throw new Error(`Validation failed at row ${i + 2}: Missing companyName or contactEmail.`);
        }

        leadsToCreate.push({
            tenantId: tenantId,
            companyName: companyName,
            contactEmail: [contactEmail.trim()], // Email is an array in your schema
            contactName: row.contactName || row['Full Name'] || null,
            contactPhone: row.contactPhone ? [row.contactPhone] : [],
            linkedInUrl: row.linkedInUrl || row['LinkedIn URL'] || null,
            companySize: row.companySize ? parseInt(row.companySize, 10) : 0,
            source: lead_source.CSV_UPLOAD,
        });
    }

    // 3. Execute the entire creation process within a single transaction
    try {
        const result = await prisma.$transaction(async (tx) => {
            // The 'tx' object is the transaction client
            for (const leadData of leadsToCreate) {
                await tx.lead.create({
                    data: leadData,
                });
            }

            // The value returned here will be the result of the prisma.$transaction call
            return { count: leadsToCreate.length };
        });

        return {
            message: `Successfully created ${result.count} leads.`,
            count: result.count,
        };

    } catch (error) {
        // This will catch any error during the transaction (e.g., duplicate unique field)
        // and Prisma will automatically roll it back.
        let errorMessage = `Database transaction failed: ${error.message}`;
        if (error.code === 'P2002') {
             errorMessage = `Transaction failed due to a duplicate entry. Please ensure all 'linkedInUrl' values are unique in your CSV.`;
        }
        throw new Error(errorMessage);
    }
}