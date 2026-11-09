// All certificate metadata, support queries and delivery state live in private R2.
// Conditional writes protect concurrent organisers and create-once email requests.
import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { certificateObjectClient } from './certificateStorage.js';
export const certificateIndexKey = 'portal/certificate-index.json';
const conflict = () => Object.assign(new Error('This record changed. Refresh and review before saving again.'), { status: 409 });
const precondition = e => e.$metadata?.httpStatusCode === 412 || e.name === 'PreconditionFailed';
export function certificateJsonStore() {
  const { client, bucket } = certificateObjectClient();
  return {
    async get(key) {
      try { const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key })); return { value: JSON.parse(await r.Body.transformToString()), etag: r.ETag }; }
      catch(e) { if(e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null; throw e; }
    },
    async put(key, value, etag) {
      return client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(value), ContentType: 'application/json',
        CacheControl: 'private, no-store', ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }) }));
    },
    async list(prefix) {
      const keys = []; let token;
      do { const r = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })); keys.push(...(r.Contents || []).map(x=>x.Key)); token = r.NextContinuationToken; } while(token);
      const rows = [];
      for(let i=0;i<keys.length;i+=10) rows.push(...(await Promise.all(keys.slice(i,i+10).map(key=>this.get(key)))).filter(Boolean).map(x=>x.value));
      return rows;
    },
  };
}
const keyPart = value => { if(typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw Object.assign(new Error('Invalid record identifier.'),{status:400}); return value; };
function matches(row, filter) {
  return Object.entries(filter).every(([key,value]) => {
    if(key === '$or') return value.some(f=>matches(row,f));
    if(value instanceof RegExp) return value.test(String(row[key] || ''));
    if(value && typeof value === 'object') {
      if('$in' in value) return value.$in.includes(row[key]);
      if('$exists' in value) return (row[key] !== undefined) === value.$exists;
      if('$lt' in value) return new Date(row[key]).getTime() < new Date(value.$lt).getTime();
    }
    return row[key] === value;
  });
}
function mutate(row, update) {
  Object.assign(row, update.$set || {});
  for(const [key,value] of Object.entries(update.$push || {})) (row[key] ||= []).push(value);
  row.updatedAt = new Date().toISOString(); row._version = randomUUID();
  return row;
}
// A small chainable query interface keeps route dependency injection simple. No database driver is used.
function query(run, many, document) {
  let offset=0, limit=Infinity, sort;
  const execute = async (plain=false) => {
    let rows=await run();
    if(!many) return rows ? plain ? rows : document(rows) : null;
    if(sort) { const [key,direction]=Object.entries(sort)[0]; rows.sort((a,b)=>String(a[key]||'').localeCompare(String(b[key]||''))*direction); }
    rows=rows.slice(offset,offset+limit); return plain ? rows : rows.map(document);
  };
  return { select(){return this;}, limit(n){limit=n;return this;}, skip(n){offset=n;return this;}, sort(value){sort=value;return this;}, lean(){return execute(true);}, then(resolve,reject){return execute().then(resolve,reject);} };
}
export function createCertificateRepositories(storeFactory = certificateJsonStore) {
  let clientStore;
  const store = () => (clientStore ||= storeFactory());
  async function index() { return await store().get(certificateIndexKey) || { value: { version: 1, records: [] }, etag: null }; }
  async function editIndex(change) {
    for(let n=0;n<8;n++) {
      const snapshot=await index(); const result=change(snapshot.value.records);
      try { await store().put(certificateIndexKey,snapshot.value,snapshot.etag); return result; }
      catch(e) { if(!precondition(e))throw e; }
    }
    throw conflict();
  }
  function model(kind, idField) {
    const prefix=`portal/${kind}/`;
    const all = async()=>kind==='certificates' ? (await index()).value.records : store().list(prefix);
    const findRow = async filter => {
      const id=filter[idField] || filter._id;
      if(kind!=='certificates' && id) { const r=await store().get(`${prefix}${keyPart(id)}.json`); return r && matches(r.value,filter) ? r.value : null; }
      return (await all()).find(row=>matches(row,filter)) || null;
    };
    const document = row => {
      const doc=structuredClone(row), version=row._version;
      Object.defineProperty(doc,'save',{enumerable:false,value:async()=>{
        const saved=await editIndex(records=>{
          const i=records.findIndex(r=>r[idField]===doc[idField]);
          if(i<0 || records[i]._version!==version)throw conflict();
          records[i]=mutate(structuredClone(doc),{}); return structuredClone(records[i]);
        });
        Object.assign(doc,saved); return doc;
      }});return doc;
    };
    return {
      find: filter=>query(async()=>(await all()).filter(r=>matches(r,filter)),true,document),
      findOne: filter=>query(()=>findRow(filter),false,document),
      exists: async filter=>Boolean(await findRow(filter)),
      countDocuments: async filter=>(await all()).filter(r=>matches(r,filter)).length,
      async create(value) {
        const row={history:[],...structuredClone(value),_id:value[idField],_version:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
        if(kind==='queries') {row.status ||= 'new';row.resolution ||= '';}
        try {
          if(kind==='certificates') await editIndex(records=>{if(records.some(r=>r[idField]===row[idField] || r.sourceId===row.sourceId))throw Object.assign(new Error('Duplicate record'),{code:11000});records.push(row);});
          else await store().put(`${prefix}${keyPart(row[idField])}.json`,row);
        }catch(e){if(precondition(e))e.code=11000;throw e;}
        return document(row);
      },
      async findOneAndUpdate(filter, update) {
        if(kind==='certificates' && update.$set?.lastEmailRequestedAt) {
          const row=await findRow({publicId:filter.publicId,published:true});if(!row)return null;
          const key=`portal/cooldowns/${keyPart(row.publicId)}.json`, old=await store().get(key);
          if(old && Date.now()-new Date(old.value.at).getTime()<60000)return null;
          try{await store().put(key,{at:new Date().toISOString()},old?.etag);return document(row);}catch(e){if(precondition(e))return null;throw e;}
        }
        if(kind==='certificates') return editIndex(records=>{const row=records.find(r=>matches(r,filter));return row?structuredClone(mutate(row,update)):null;});
        const id=filter[idField] || filter._id;
        if(!id)throw new Error('Record identifier required');
        const key=`${prefix}${keyPart(id)}.json`;
        for(let n=0;n<8;n++){
          const old=await store().get(key);if(!old || !matches(old.value,filter))return null;
          const row=mutate(old.value,update);
          try{await store().put(key,row,old.etag);return document(row);}catch(e){if(!precondition(e))throw e;}
        }
        throw conflict();
      },
      async updateOne(filter, update){return this.findOneAndUpdate(filter,update);},
    };
  }
  return { certs:model('certificates','publicId'), queries:model('queries','reference'), deliveries:model('deliveries','requestId') };
}
export const certificateRepositories = createCertificateRepositories();
