import fs from 'node:fs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Registration from '../models/Registration.js';
import Counter from '../models/Counter.js';
import { registrationNumbering, ONLINE_COUNTER, IMPORT_COUNTER } from '../services/registrationNumbering.js';

dotenv.config({ quiet: true });
const apply = process.argv.includes('--apply');
const configuredUri = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8')
  .match(/mongoose\.connect\(\s*["']([^"']+)["']/)?.[1];
const uri = process.env.MONGODB_URI || process.env.MONGO_URI || configuredUri;
if (!uri) throw new Error('MongoDB configuration is required.');

try {
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  if (apply) {
    const indexes = await Counter.collection.indexes();
    if (!indexes.some(index => index.unique && index.key.name === 1)) {
      throw new Error('Counters require a unique name index before numbering can be enabled.');
    }
    const state = await registrationNumbering.state(Registration);
    // Idempotent preparation: never reset existing cursors or touch attendee records.
    await Counter.updateOne({ name: ONLINE_COUNTER }, { $setOnInsert: { seq: state.onlineSeq } }, { upsert: true });
    await Counter.updateOne({ name: IMPORT_COUNTER }, { $setOnInsert: { seq: state.importSeq } }, { upsert: true });
    await Counter.updateOne({ name: 'registrationAllocationLock' }, { $setOnInsert: { seq: 0 } }, { upsert: true });
  }
  const state = await registrationNumbering.state(Registration);
  console.log(JSON.stringify({ apply, database: mongoose.connection.db.databaseName, onlineCounter: state.onlineSeq, importCounter: state.importSeq,
    nextOnline: state.nextOnline, nextImport: state.nextImport, highestAllocated: state.maxUsed }));
} finally { await mongoose.disconnect(); }
