// Offline by default. --apply stores certificate lookup metadata in private Cloudflare R2.
// No MongoDB connection, database collections or attendee email sends.
import 'dotenv/config';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { certificateJsonStore, certificateIndexKey } from '../services/certificateRepository.js';
import { certificateCategories, fileType, emailIsValid, normalizeCertificateName, personKey } from '../utils/certificatePortal.js';
const args=process.argv.slice(2);
if(args.some(a=>a!=='--apply'))throw new Error('Only --apply is supported.');
const plan=JSON.parse(await fs.readFile('reports/certificate-portal/import-plan.json','utf8'));
if(plan.version!==1 || !plan.records.length || plan.issues.length)throw new Error('Prepare and verify the complete import plan before importing.');
const ids=new Set();
for(const row of plan.records){
 if(!certificateCategories.includes(row.category)||!row.identityVerified||!emailIsValid(row.email)||ids.has(row.sourceId))throw new Error('Invalid or duplicate certificate mapping.');
 if(!row.name||row.name.length>180||!row.role||row.role.length>80||!row.title||row.title.length>1000)throw new Error(`Invalid fields: ${row.sourceId}`);
 ids.add(row.sourceId);
 const bytes=await fs.readFile(row.file);
 if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw new Error(`Changed certificate: ${row.sourceId}`);
 fileType(bytes);
}
console.log(`Verified ${plan.records.length} certificate files. Nursing is excluded.`);
if(!args.includes('--apply')){
 console.log('DRY RUN: no uploads, database connections, writes or emails.');
}else{
 const uploaded=JSON.parse(await fs.readFile('reports/certificate-portal/storage-upload.json','utf8'));
 if(uploaded.bucket!==process.env.CERTIFICATE_BUCKET_NAME)throw new Error('Upload bucket mismatch');
 const uploads=new Map(uploaded.records.map(r=>[r.sourceId,r]));
 for(const row of plan.records)if(uploads.get(row.sourceId)?.sha256!==row.sha256)throw new Error(`Upload not verified: ${row.sourceId}`);
 const store=certificateJsonStore();let imported=false;
 for(let n=0;n<8;n++){
  const old=await store.get(certificateIndexKey);
  const records=old?.value.records || [];
  for(const row of plan.records){
   const i=records.findIndex(r=>r.sourceId===row.sourceId),existing=records[i];
   if(existing?.history?.some(h=>h.action==='updated'))continue;
   const {file,identityVerified,publicationNote,...data}=row;
   const publicId=existing?.publicId || createHash('sha256').update(`aoacon2026:${row.sourceId}`).digest('hex').slice(0,32);
   const saved={...data,...uploads.get(row.sourceId),publicId,_id:publicId,_version:row.sha256,
    personKey:personKey(row.email,row.name),searchName:normalizeCertificateName(row.name),
    createdAt:existing?.createdAt || new Date().toISOString(),updatedAt:new Date().toISOString(),
    history:existing?.history || [{at:new Date().toISOString(),actor:'verified-import',action:'imported',note:publicationNote || 'Hash-verified approved certificate imported into private R2.'}]};
   if(i<0)records.push(saved);else records[i]=saved;
  }
  try{
   await store.put(certificateIndexKey,{version:1,updatedAt:new Date().toISOString(),records},old?.etag);
   await fs.writeFile('reports/certificate-portal/cloudflare-import.json',JSON.stringify({at:new Date().toISOString(),records:records.length,published:records.filter(r=>r.published).length,bucket:uploaded.bucket,storage:'Cloudflare R2',mongoDBUsed:false},null,2)+'\n');
   console.log(`Imported ${records.length} lookup records into private Cloudflare R2. No MongoDB or email sends.`);imported=true;break;
  }catch(e){if(e.$metadata?.httpStatusCode!==412)throw e;}
 }
 if(!imported)throw new Error('Index changed repeatedly; retry after reviewing concurrent activity.');
}
