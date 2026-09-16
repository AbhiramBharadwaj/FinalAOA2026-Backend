import mongoose from 'mongoose';
import FacultyCv from '../models/FacultyCv.js';

const DEFAULT_SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1_8x62qo_-2Uw76n_vMa2ud-MZxkIL2zvbHp0AZ4FdZs/export?format=csv&gid=0';

const mongoUri =
  process.env.MONGODB_URI ||
  'mongodb+srv://bhaskarAntoty123:MQEJ1W9gtKD547hy@bhaskarantony.wagpkay.mongodb.net/AOA1?retryWrites=true&w=majority';

const csvUrl = process.env.FACULTY_SHEET_CSV_URL || DEFAULT_SHEET_CSV_URL;

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const run = async () => {
  const response = await fetch(csvUrl);
  if (!response.ok) {
    throw new Error(`Could not fetch faculty sheet CSV: ${response.status}`);
  }

  const rows = parseCsv(await response.text());
  const [, ...dataRows] = rows;
  const byEmail = new Map();

  dataRows.forEach((row, index) => {
    const sourceSheetRow = index + 2;
    const name = String(row[0] || '').trim();
    const email = normalizeEmail(row[1]);
    const role = String(row[3] || '').trim();

    if (!name || !email) return;
    if (!byEmail.has(email)) {
      byEmail.set(email, { name, email, role, sourceSheetRow });
    }
  });

  await mongoose.connect(mongoUri);

  let upserted = 0;
  for (const faculty of byEmail.values()) {
    await FacultyCv.updateOne(
      { email: faculty.email },
      {
        $set: {
          name: faculty.name,
          role: faculty.role,
          sourceSheetRow: faculty.sourceSheetRow,
          isActive: true,
        },
        $setOnInsert: {
          cvStatus: 'NOT_UPLOADED',
        },
      },
      { upsert: true }
    );
    upserted += 1;
  }

  const activeEmails = [...byEmail.keys()];
  const inactiveResult = await FacultyCv.updateMany(
    { email: { $nin: activeEmails } },
    { $set: { isActive: false } }
  );

  console.log(JSON.stringify({
    source: csvUrl,
    upserted,
    markedInactive: inactiveResult.modifiedCount,
  }, null, 2));

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
