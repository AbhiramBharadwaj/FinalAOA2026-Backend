import Counter from '../models/Counter.js';

export const ONLINE_LIMIT = 600;
export const IMPORT_COUNTER = 'registrationImportNumber';
export const ONLINE_COUNTER = 'registrationNumber';
const LOCK_COUNTER = 'registrationAllocationLock';
const RESERVATION_PREFIX = 'registrationNumberReservation:';
const PREFIX = 'AOA2026-';

export const buildRegistrationNumber = (seq) => `${PREFIX}${String(seq).padStart(4, '0')}`;
export const parseRegistrationSeq = (number) => {
  const match = /^AOA2026-(\d+)$/.exec(String(number || ''));
  const seq = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(seq) && seq > 0 ? seq : null;
};

const failure = (message) => Object.assign(new Error(message), { statusCode: 409 });

export function createRegistrationNumbering({ CounterModel = Counter, ReservationModel = Counter } = {}) {
  async function state(RegistrationModel, session = null) {
    // Do not parallelize Mongo operations on a transaction's session.
    const registrations = await RegistrationModel.find({ registrationNumber: { $regex: /^AOA2026-\d+$/ } })
      .select('registrationNumber').session(session).lean();
    const reservations = await ReservationModel.find({ name: { $regex: `^${RESERVATION_PREFIX}` } })
      .select('seq').session(session).lean();
    const used = new Set(registrations.map(r => parseRegistrationSeq(r.registrationNumber)).filter(Boolean));
    for (const r of reservations) used.add(r.seq);
    const maxUsed = Math.max(0, ...used);
    const onlineMax = Math.max(0, ...[...used].filter(n => n <= ONLINE_LIMIT));
    const online = await CounterModel.findOne({ name: ONLINE_COUNTER }).session(session).lean();
    const imports = await CounterModel.findOne({ name: IMPORT_COUNTER }).session(session).lean();
    const onlineSeq = online?.seq ?? onlineMax;
    const importSeq = Math.max(ONLINE_LIMIT, imports?.seq ?? 0, maxUsed);
    const high = Math.max(maxUsed, onlineSeq, importSeq);
    let nextOnline = onlineSeq + 1;
    while (nextOnline <= ONLINE_LIMIT && used.has(nextOnline)) nextOnline++;
    if (nextOnline > ONLINE_LIMIT) nextOnline = high + 1;
    return { used, maxUsed, onlineMax, onlineSeq, importSeq, high, nextOnline, nextImport: high + 1 };
  }

  async function locked(RegistrationModel, session, callback) {
    const run = async activeSession => {
      // All allocation and counter edits contend on this document, including overflow.
      await CounterModel.findOneAndUpdate({ name: LOCK_COUNTER }, { $inc: { seq: 1 } },
        { new: true, upsert: true, session: activeSession });
      return callback(activeSession);
    };
    if (session?.inTransaction()) return run(session);
    const ownSession = await RegistrationModel.db.startSession();
    let result;
    try { await ownSession.withTransaction(async () => { result = await run(ownSession); }); }
    finally { await ownSession.endSession(); }
    return result;
  }

  function importCandidate(s, preferredSeq, exact) {
    if (preferredSeq !== undefined && (!Number.isSafeInteger(preferredSeq) || preferredSeq < 1)) {
      throw failure('A valid integer registration number is required.');
    }
    if (exact) {
      if (s.used.has(preferredSeq)) throw failure('Registration number is already used or reserved.');
      if (preferredSeq <= ONLINE_LIMIT && preferredSeq > s.onlineSeq) {
        throw failure('Unissued numbers through 0600 are reserved for online registrations.');
      }
      return preferredSeq;
    }
    if (preferredSeq && preferredSeq <= ONLINE_LIMIT) {
      for (let n = preferredSeq; n <= Math.min(s.onlineSeq, ONLINE_LIMIT); n++) {
        if (!s.used.has(n)) return n;
      }
    }
    return Math.max(s.nextImport, preferredSeq || 0);
  }

  async function allocate(RegistrationModel, { source = 'online', preferredSeq, exact = false, session } = {}) {
    if (!['online', 'import'].includes(source)) throw failure('Unknown registration numbering source.');
    if (exact && preferredSeq === undefined) throw failure('An exact registration number is required.');
    return locked(RegistrationModel, session, async activeSession => {
      const s = await state(RegistrationModel, activeSession);
      const seq = source === 'online' ? s.nextOnline : importCandidate(s, preferredSeq, exact);
      if (seq >= 100000) throw failure('Registration number range is exhausted.');
      // Reuse the existing unique counter-name index, avoiding a new collection.
      await ReservationModel.create([{ name: `${RESERVATION_PREFIX}${seq}`, seq }], { session: activeSession });
      // Importing a high ID must never move the online cursor.
      const counterName = source === 'online' ? ONLINE_COUNTER : IMPORT_COUNTER;
      const initial = source === 'online' ? s.onlineSeq : s.importSeq;
      await CounterModel.findOneAndUpdate({ name: counterName }, { $max: { seq: Math.max(initial, seq) } },
        { upsert: true, new: true, session: activeSession });
      return { seq, registrationNumber: buildRegistrationNumber(seq) };
    });
  }

  async function preview(RegistrationModel, { source = 'online', preferredSeq } = {}) {
    const s = await state(RegistrationModel);
    const seq = source === 'online' ? s.nextOnline : importCandidate(s, preferredSeq, false);
    return { seq, registrationNumber: buildRegistrationNumber(seq) };
  }

  async function updateCounter(RegistrationModel, { source = 'online', seq }) {
    if (!['online', 'import'].includes(source) || !Number.isSafeInteger(seq) || seq < 0) {
      throw failure('A valid source and non-negative integer counter are required.');
    }
    return locked(RegistrationModel, null, async session => {
      const s = await state(RegistrationModel, session);
      const minimum = source === 'online' ? Math.max(s.onlineSeq, s.onlineMax) : s.importSeq;
      if (seq < minimum) throw failure(`Counter cannot be set below its current allocation (${minimum}).`);
      await CounterModel.findOneAndUpdate({ name: source === 'online' ? ONLINE_COUNTER : IMPORT_COUNTER },
        { $max: { seq } }, { upsert: true, new: true, session });
      return seq;
    });
  }

  return { allocate, preview, state, updateCounter };
}

export const registrationNumbering = createRegistrationNumbering();
