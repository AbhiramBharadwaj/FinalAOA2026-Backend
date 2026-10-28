import dotenv from 'dotenv';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import Registration from '../models/Registration.js';

dotenv.config();
const server = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');
const uri = process.env.MONGODB_URI || process.env.MONGO_URI || server.match(/mongoose\.connect\(\s*["']([^"']+)["']/)?.[1];
if (!uri) throw new Error('MongoDB configuration missing');
try {
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  // Use the raw collection to preserve registration updatedAt timestamps.
  const collection = Registration.collection;
  const filter = { TypeOfIdCard: null };
  const pending = await collection.countDocuments(filter);
  if (process.argv.includes('--apply')) {
    const result = await collection.updateMany(filter, { $set: { TypeOfIdCard: '' } });
    const remaining = await collection.countDocuments(filter);
    console.log(JSON.stringify({ matched: result.matchedCount, updated: result.modifiedCount, remaining }));
    if (remaining) throw new Error('Backfill verification failed');
  } else {
    console.log(JSON.stringify({ pending, preview: true, apply: 'node scripts/backfill-registration-id-card.js --apply' }));
  }
} finally {
  await mongoose.disconnect();
}
