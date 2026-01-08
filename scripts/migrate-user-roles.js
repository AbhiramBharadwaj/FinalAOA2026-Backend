import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';

dotenv.config();

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb+srv://bhaskarAntoty123:MQEJ1W9gtKD547hy@bhaskarantony.wagpkay.mongodb.net/AOA1?retryWrites=true&w=majority';

const ROLE_MAP = {
  'AOA Member': 'AOA',
  'Non-AOA Member': 'NON_AOA',
  'PGs & Fellows': 'PGS',
};

const runMigration = async () => {
  try {
    await mongoose.connect(MONGODB_URI);

    const updates = Object.entries(ROLE_MAP).map(([legacyRole, normalizedRole]) => ({
      updateMany: {
        filter: { role: legacyRole },
        update: { $set: { role: normalizedRole } },
      },
    }));

    const result = await User.bulkWrite(updates);
    const modified =
      (result.modifiedCount ?? 0) ||
      (result.result?.nModified ?? 0) ||
      0;

    console.log(`Role migration complete. Updated ${modified} user(s).`);
  } catch (error) {
    console.error('Role migration failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

runMigration();
