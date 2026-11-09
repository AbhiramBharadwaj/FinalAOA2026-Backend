import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createCertificateRouter} from '../routes/certificates.js';
import {eventReadOnly} from '../middleware/eventReadOnly.js';
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const certificateId='certificate-123456',reference='AOA-1234567890';
const chain=value=>({lean:async()=>value});
async function setup(t,{mailError,authenticated=true}={}){
 let sends=0,saves=0,queryUpdates=0,attempt;
 const row={publicId:certificateId,name:'Dr. Old Name',email:'registered@example.com',personKey:'key',role:'Delegate',title:'AOACON 2026 Conference',category:'conference',objectKey:'old-image.png',history:[],async save(){saves++;}};
 const query={reference,name:'Dr. Correct Name',email:'requester@example.com',certificateId,status:'new'};
 const app=express();app.use('/api',eventReadOnly);app.use(express.json());
 app.use('/api/certificates',createCertificateRouter({limiters:false,adminAuth:(req,res,next)=>authenticated?next():res.sendStatus(401),
 certs:{find:()=>chain([row]),findOne:async()=>row},
 queries:{findOne:()=>chain(query),updateOne:async(filter,update)=>{queryUpdates++;Object.assign(query,update.$set);}},
 deliveries:{findOne:()=>chain(attempt),create:async value=>(attempt={...value,_id:value.requestId}),updateOne:async(filter,update)=>Object.assign(attempt,update.$set)},
 storage:()=>({put:async bytes=>{assert.deepEqual(bytes,image);return{objectKey:'corrected-image.png',sha256:'hash',contentType:'image/png'};}}),
 mail:async payload=>{sends++;assert.equal(saves,1);assert.equal(payload.to,'requester@example.com');assert.deepEqual(payload.attachments[0].content,image);assert.equal(payload.subject,'AOACON 2026 — Your Corrected E-Certificate');assert.ok(payload.html.includes('Here is your corrected certificate.'));if(mailError)throw mailError;return{provider:'mock',messageId:'test'};}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 return {row,query,get attempt(){return attempt;},get sends(){return sends;},get saves(){return saves;},get queryUpdates(){return queryUpdates;},async send({file=true,id=certificateId,name='Dr. Correct Name'}={}){
 const body=new FormData();body.set('certificateId',id);body.set('name',name);body.set('role','Faculty');body.set('message','Here is your corrected certificate.');body.set('requestId','correction-request-1234');if(file)body.set('file',new Blob([image],{type:'image/png'}),'screenshot.png');
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/certificates/admin/queries/${reference}/resolve-certificate`,{method:'POST',body});return{status:response.status,body:response.status===401?null:await response.json()};}};
}
test('uploaded screenshot replaces selected certificate and emails only the requester, then resolves query',async t=>{
 const app=await setup(t);const result=await app.send();assert.equal(result.status,200);assert.equal(result.body.resolved,true);assert.equal(app.row.name,'Dr. Correct Name');assert.equal(app.row.role,'Faculty');assert.equal(app.row.email,'registered@example.com');assert.equal(app.row.objectKey,'corrected-image.png');assert.match(app.row.history[0].note,/old-image.png/);assert.equal(app.query.status,'resolved');assert.equal(app.attempt.status,'accepted');
 const repeat=await app.send();assert.equal(repeat.status,200);assert.equal(app.sends,1);assert.equal(app.saves,1);
 const changed=await app.send({name:'Dr. Another Name'});assert.equal(changed.status,400);assert.equal(app.sends,1);
});
test('an unconfirmed provider response leaves query unresolved and cannot auto-resend',async t=>{
 const app=await setup(t,{mailError:new Error('Timeout')});assert.equal((await app.send()).status,502);assert.equal(app.query.status,'new');assert.equal(app.queryUpdates,0);assert.equal(app.attempt.status,'unknown');assert.equal((await app.send()).status,409);assert.equal(app.sends,1);
});
test('missing attachments and unrelated certificates cause no writes or emails',async t=>{
 const app=await setup(t);assert.equal((await app.send({file:false})).status,400);assert.equal((await app.send({id:'unrelated-certificate-123'})).status,400);assert.equal(app.saves,0);assert.equal(app.sends,0);assert.equal(app.attempt,undefined);
});
test('correction upload and email requires organiser authentication',async t=>{
 const app=await setup(t,{authenticated:false});assert.equal((await app.send()).status,401);assert.equal(app.sends,0);assert.equal(app.saves,0);
});
