import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCertificateQueryContext} from '../utils/certificateQueryContext.js';
const q={reference:'AOA-1111111111',name:'Dr Ananya Rao',email:'contact@example.com',remarks:'Correct my name'};
const certs=[{publicId:'conference-id',sourceId:'conference-FAC1',name:'Dr. ANANYA RAO',email:q.email,category:'conference',role:'Faculty',published:true},{publicId:'workshop-id',sourceId:'labour-FAC1',name:'Dr. Ananya',email:q.email,category:'labour',role:'Faculty',published:true},{publicId:'unrelated-id',sourceId:'conference-OTHER',name:'Dr. Someone Else',email:'someone@example.com'}];
test('query background shows all matching certificates and highlights printed-name differences',()=>{
 const result=buildCertificateQueryContext(q,certs,[],[],{'conference-FAC1':{creditHours:'4'}});
 assert.equal(result.certificates.length,2);assert.equal(result.certificates[0].nameDiffers,false);assert.equal(result.certificates[1].nameDiffers,true);assert.equal(result.certificates[0].creditHours,'4');assert.equal(result.selectedCertificateId,'');
});
test('name-only matches remain explicitly unconfirmed',()=>{
 const result=buildCertificateQueryContext({...q,email:'new-address@example.com'},certs,[],[]);
 assert.equal(result.certificates.length,1);assert.equal(result.certificates[0].possibleMatch,true);
});
test('selected certificate links the recorded contact across courses without requiring the new contact email to match',()=>{
 const result=buildCertificateQueryContext({...q,email:'new-address@example.com',certificateId:'conference-id'},certs,[],[]);
 assert.equal(result.certificates.length,2);assert.equal(result.selectedCertificateId,'conference-id');assert.ok(result.certificates[0].matchReasons.includes('Selected in this query'));
});
test('prior queries and email history exclude unrelated contacts and preserve actual provider status',()=>{
 const result=buildCertificateQueryContext(q,certs,[q,{...q,reference:'AOA-2222222222'},{reference:'AOA-3333333333',email:'unrelated@example.com'}],[{certificateId:'conference-id',status:'accepted'},{certificateId:'unrelated-id',status:'accepted'}]);
 assert.equal(result.previousQueries.length,1);assert.equal(result.emailRequests.length,1);assert.equal(result.emailRequests[0].status,'accepted');assert.match(result.note,/does not confirm inbox delivery/);
});
