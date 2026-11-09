import test from 'node:test';
import assert from 'node:assert/strict';
import { createCertificateRepositories, certificateIndexKey } from '../services/certificateRepository.js';
function memoryStore() {
 const objects=new Map();let revision=0;
 return { objects,
  async get(key){const r=objects.get(key);return r?structuredClone(r):null;},
  async put(key,value,etag){const old=objects.get(key);if(etag ? old?.etag!==etag : Boolean(old))throw Object.assign(new Error('Precondition failed'),{name:'PreconditionFailed',$metadata:{httpStatusCode:412}});objects.set(key,{value:structuredClone(value),etag:String(++revision)});},
  async list(prefix){return [...objects].filter(([key])=>key.startsWith(prefix)).map(([,r])=>structuredClone(r.value));},
 };
}
const sample={publicId:'certificate-123',sourceId:'source-123',name:'Dr. Ananya Rao',email:'ananya@example.com',role:'Faculty',published:true,searchName:'ananya rao',personKey:'person-key',category:'conference'};
test('certificate metadata uses private R2 index; concurrent edits cannot overwrite each other',async()=>{
 const store=memoryStore(), {certs}=createCertificateRepositories(()=>store);
 await certs.create(sample);
 assert.equal(store.objects.has(certificateIndexKey),true);
 const a=await certs.findOne({publicId:sample.publicId}),b=await certs.findOne({publicId:sample.publicId});
 a.email='corrected@example.com';await a.save();b.name='Stale update';
 await assert.rejects(()=>b.save(),e=>e.status===409);
 assert.equal((await certs.findOne({publicId:sample.publicId}).lean()).email,'corrected@example.com');
 assert.equal((await certs.find({published:true,$or:[{searchName:/ananya/}]}).limit(1).lean()).length,1);
});
test('two server instances cannot create duplicate delivery requests or reserve the same cooldown',async()=>{
 const store=memoryStore(),a=createCertificateRepositories(()=>store),b=createCertificateRepositories(()=>store);
 await a.certs.create(sample);
 const delivery={requestId:'request-123',certificateId:sample.publicId,to:'other@example.com',status:'pending'};
 const outcomes=await Promise.allSettled([a.deliveries.create(delivery),b.deliveries.create(delivery)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(outcomes.find(r=>r.status==='rejected').reason.code,11000);
 const filter={publicId:sample.publicId,published:true},mutation={$set:{lastEmailRequestedAt:new Date()}};
 const reserved=await Promise.all([a.certs.findOneAndUpdate(filter,mutation),b.certs.findOneAndUpdate(filter,mutation)]);
 assert.equal(reserved.filter(Boolean).length,1);
 await a.deliveries.updateOne({_id:'request-123'},{$set:{status:'accepted'}});
 assert.equal((await b.deliveries.findOne({requestId:'request-123'}).lean()).status,'accepted');
});
test('queries, status updates, remarks and history persist entirely in R2',async()=>{
 const store=memoryStore(),a=createCertificateRepositories(()=>store),b=createCertificateRepositories(()=>store);
 await a.queries.create({reference:'AOA-1234567890',name:'Ananya',email:'contact@example.com',issue:'missing',remarks:'My faculty certificate is missing.'});
 await b.queries.findOneAndUpdate({reference:'AOA-1234567890'},{$set:{status:'resolved',resolution:'Uploaded your corrected certificate.'},$push:{history:{actor:'Organiser',note:'Approved correction'}}});
 assert.equal(await a.queries.countDocuments({status:'resolved'}),1);
 const row=(await a.queries.find({status:'resolved'}).sort({createdAt:-1}).skip(0).limit(30).lean())[0];
 assert.equal(row.history[0].note,'Approved correction');
 assert.equal(row.email,'contact@example.com');
});
