import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistrationNumbering, buildRegistrationNumber, parseRegistrationSeq } from '../services/registrationNumbering.js';

function harness({ online = 554, imported = 600, existing = [554] } = {}) {
  const counters = new Map([['registrationNumber', online], ['registrationImportNumber', imported]]);
  const reservations = [];
  let queue = Promise.resolve();
  const query = value => ({ select() { return this; }, session() { return this; }, async lean() { return value; } });
  const RegistrationModel = {
    find: () => query(existing.map(seq => ({ registrationNumber: buildRegistrationNumber(seq) }))),
    db: { async startSession() {
      return { inTransaction: () => true, async endSession() {}, async withTransaction(callback) {
        // Model the common lock document's serialization, including rollback.
        const previous = queue;
        let release;
        queue = new Promise(resolve => { release = resolve; });
        await previous;
        const snapshot = new Map(counters); const count = reservations.length;
        try { await callback(); } catch (error) {
          counters.clear(); for (const [k, v] of snapshot) counters.set(k, v);
          reservations.length = count; throw error;
        } finally { release(); }
      } };
    } },
  };
  const CounterModel = {
    findOne: ({ name }) => query(counters.has(name) ? { seq: counters.get(name) } : null),
    async findOneAndUpdate({ name }, update) {
      let seq = counters.get(name) || 0;
      if (update.$inc) seq += update.$inc.seq;
      if (update.$max) seq = Math.max(seq, update.$max.seq);
      counters.set(name, seq); return { seq };
    },
  };
  const ReservationModel = {
    find: () => query(reservations),
    async create(rows) {
      for (const row of rows) {
        if (reservations.some(r => r.seq === row.seq)) throw Error('Duplicate reservation');
        reservations.push(row);
      }
    },
  };
  return { numbering: createRegistrationNumbering({ CounterModel, ReservationModel }), RegistrationModel, counters, reservations };
}

test('imports start at 0601 and do not move the online counter', async () => {
  const h = harness();
  assert.equal((await h.numbering.allocate(h.RegistrationModel, { source: 'import' })).seq, 601);
  assert.equal(h.counters.get('registrationNumber'), 554);
  assert.equal((await h.numbering.allocate(h.RegistrationModel)).seq, 555);
  assert.equal((await h.numbering.preview(h.RegistrationModel, { source: 'import' })).seq, 602);
});

test('50 imports coexist with all 46 reserved online numbers, then share the latest sequence', async () => {
  const h = harness();
  for (let i = 601; i <= 650; i++) {
    assert.equal((await h.numbering.allocate(h.RegistrationModel, { source: 'import' })).seq, i);
  }
  for (let i = 555; i <= 600; i++) assert.equal((await h.numbering.allocate(h.RegistrationModel)).seq, i);
  assert.equal((await h.numbering.allocate(h.RegistrationModel)).seq, 651);
  assert.equal((await h.numbering.allocate(h.RegistrationModel, { source: 'import' })).seq, 652);
  assert.equal((await h.numbering.allocate(h.RegistrationModel)).seq, 653);
});

test('simultaneous online and import allocations are unique before and after overflow', async () => {
  const h = harness({ online: 599, imported: 650, existing: [599, 650] });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    h.numbering.allocate(h.RegistrationModel, { source: i % 2 ? 'import' : 'online' })));
  assert.equal(results[0].seq, 600);
  assert.equal(new Set(results.map(r => r.seq)).size, 20);
  assert.deepEqual(results.slice(1).map(r => r.seq), Array.from({ length: 19 }, (_, i) => 651 + i));
});

test('failed registration saves leave a reservation that cannot be reused as a gap', async () => {
  const h = harness();
  await h.numbering.allocate(h.RegistrationModel);
  await assert.rejects(h.numbering.allocate(h.RegistrationModel, {
    source: 'import', exact: true, preferredSeq: 555,
  }), /already used or reserved/);
  assert.equal((await h.numbering.allocate(h.RegistrationModel)).seq, 556);
});

test('manual gap allocation preserves both cursors and never takes unissued online slots', async () => {
  const h = harness();
  assert.equal((await h.numbering.allocate(h.RegistrationModel, { source: 'import', exact: true, preferredSeq: 24 })).seq, 24);
  assert.equal(h.counters.get('registrationNumber'), 554);
  assert.equal(h.counters.get('registrationImportNumber'), 600);
  await assert.rejects(h.numbering.allocate(h.RegistrationModel, { source: 'import', exact: true, preferredSeq: 556 }), /reserved for online/);
});

test('occupied online IDs are skipped, and missing cursors are reconstructed by range', async () => {
  const h = harness({ existing: [554, 555, 601] });
  assert.equal((await h.numbering.allocate(h.RegistrationModel)).seq, 556);
  h.counters.delete('registrationNumber'); h.counters.delete('registrationImportNumber');
  const state = await h.numbering.state(h.RegistrationModel);
  assert.equal(state.onlineSeq, 556);
  assert.equal(state.nextOnline, 557);
  assert.equal(state.nextImport, 602);
});

test('admin edits validate source/integer and cannot rewind or let imports move the online cursor', async () => {
  const h = harness();
  await h.numbering.updateCounter(h.RegistrationModel, { source: 'import', seq: 650 });
  assert.equal((await h.numbering.preview(h.RegistrationModel)).seq, 555);
  await assert.rejects(h.numbering.updateCounter(h.RegistrationModel, { source: 'import', seq: 600 }), /cannot be set below/);
  await assert.rejects(h.numbering.updateCounter(h.RegistrationModel, { source: 'online', seq: 553 }), /cannot be set below/);
  await assert.rejects(h.numbering.updateCounter(h.RegistrationModel, { source: 'online', seq: 555.5 }), /valid source/);
  await assert.rejects(h.numbering.allocate(h.RegistrationModel, { source: 'other' }), /Unknown/);
  assert.equal(parseRegistrationSeq('AOA2026-0555junk'), null);
  assert.equal(parseRegistrationSeq('AOA2026-0555'), 555);
});
