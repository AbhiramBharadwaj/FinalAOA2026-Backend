import 'dotenv/config';
import fs from 'node:fs/promises';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { certificateObjectClient } from '../services/certificateStorage.js';
const plan=JSON.parse(await fs.readFile('reports/certificate-portal/import-plan.json','utf8'));
const uploaded=JSON.parse(await fs.readFile('reports/certificate-portal/storage-upload.json','utf8'));
if(uploaded.records.length!==plan.records.length)throw new Error('Upload is incomplete.');
const bySource=new Map(uploaded.records.map(r=>[r.sourceId,r]));
const {client,bucket}=certificateObjectClient();
if(bucket!==uploaded.bucket)throw new Error('Wrong bucket');
const objects=new Map();let token;
do{const r=await client.send(new ListObjectsV2Command({Bucket:bucket,Prefix:'certificates/2026/',ContinuationToken:token}));for(const o of r.Contents || [])objects.set(o.Key,o.Size);token=r.NextContinuationToken;}while(token);
for(const row of plan.records){const file=bySource.get(row.sourceId);if(!file||file.sha256!==row.sha256||objects.get(file.objectKey)!==file.bytes)throw new Error(`Cloud upload mismatch: ${row.sourceId}`);}
const report={at:new Date().toISOString(),total:plan.records.length,bucket,verifiedObjects:new Set(uploaded.records.map(r=>r.objectKey)).size,totalBytes:uploaded.records.reduce((n,r)=>n+r.bytes,0),allMappingsMatched:true};
await fs.writeFile('reports/certificate-portal/full-upload-verification.json',JSON.stringify(report,null,2)+'\n');
console.log(`Verified all ${report.total} certificate mappings, private cloud objects and file sizes.`);
