import csv from 'csvtojson';
import fs from 'fs';

export const parseCSVToJson = async (filePath) => {
  try {
    const jsonArray = await csv().fromFile(filePath);
    fs.unlinkSync(filePath); // Delete file after parsing
    return jsonArray;
  } catch (error) {
    throw new Error('Failed to parse CSV: ' + error.message);
  }
};
