// End-to-end read checks using live private Cloudflare metadata; never sends mail.
import 'dotenv/config';
import fs from 'node:fs/promises';
import express from 'express';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCertificateRouter } from '../routes/certificates.js';
const plan=JSON.parse(await fs.readFile('reports/certificate-portal/import-plan.json','utf8'));
const sample=plan.records.find(r=>r.published);
const app=express();app.use(express.json());app.use('/api/certificates',createCertificateRouter({enabled:()=>true,limiters:false,adminAuth:(req,res)=>res.sendStatus(401),mail:()=>{throw new Error('Sending disabled in verification');}}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
try{
 const base=`http://127.0.0.1:${server.address().port}/api/certificates`;
 const found=await fetch(`${base}/search?q=${encodeURIComponent(sample.name)}`);assert.equal(found.status,200);
 const result=await found.json();assert.ok(result.people.length);
 const id=createHash('sha256').update(`aoacon2026:${sample.sourceId}`).digest('hex').slice(0,32);
 assert.ok(result.people.some(p=>p.certificates.some(c=>c.id===id)));
 for(const p of result.people)for(const c of p.certificates){assert.equal('email' in c,false);assert.equal('objectKey' in c,false);assert.notEqual(c.category,'nursing');}
 const response=await fetch(`${base}/${id}/download`);assert.equal(response.status,200);
 const {url}=await response.json(),download=await fetch(url);assert.equal(download.status,200);
 assert.equal(createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex'),sample.sha256);
 const empty=await (await fetch(`${base}/search?q=no-such-attendee-94628731`)).json();assert.equal(empty.people.length,0);
 console.log('PASS: live Cloudflare index → API search → correct signed certificate download, privacy and no-record result. No MongoDB or emails.');
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
