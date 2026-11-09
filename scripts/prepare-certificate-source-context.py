"""Build private organiser context from approved sources and original email ledgers."""
import csv,json,pathlib
from datetime import datetime,timezone
root=pathlib.Path(__file__).resolve().parents[1]
read=lambda p:json.loads((root/p).read_text())
plan=read('reports/certificate-portal/import-plan.json')
records={r['sourceId']:{} for r in plan['records']}
source=read('reports/delegate-recipient-source.json')['values'][1:]
for i,r in enumerate(source,1):
 key=f'conference-DEL{i:04d}'
 if key in records: records[key].update(creditHours=r[2],eventDates=r[3],sourceFile='Conference delegate final sheet',sourceRow=i+1)
for r in read('reports/faculty-certificate-records.json'):
 records['conference-'+r['id']].update(creditHours=r['credit_hours'],eventDates=r['conference_dates'],sourceFile='Conference faculty final sheet — '+r['source_sheet'],sourceRow=r['source_row'])
for category in ['critical-incidents','pocus','maternal','labour','occc']:
 for r in read(f'reports/{category}-certificate-records.json'):
  records[category+'-'+r['reference']].update(sourceFile=r['source_file'],sourceRow=r['source_row'])
# OCR evidence is labelled as wording, not an inferred or recalculated entitlement.
ocr={}
for category in ['critical-incidents','pocus','maternal','labour','occc']:
 p=root/f'reports/{category}-ocr.jsonl'
 if p.exists():
  for line in p.read_text().splitlines():
   row=json.loads(line);texts=[x['text'] for x in row['lines']]
   credit=' '.join(t for t in texts if 'credit' in t.lower())
   dates=' '.join(t for t in texts if any(word in t.lower() for word in ['october','november']))
   ocr[row['file']]={'creditWording':credit,'eventDates':dates}
for row in plan['records']:
 if row['file'] in ocr: records[row['sourceId']].update(ocr[row['file']])
for folder,category in [('delegate','conference'),('faculty','conference'),('critical-incidents','critical-incidents'),('pocus','pocus'),('maternal','maternal'),('labour','labour'),('occc','occc'),('certificate','presentation'),('video-award','video-award')]:
 p=root/f'reports/{folder}-delivery/send-status.csv'
 if not p.exists():continue
 for item in csv.DictReader(p.open(encoding='utf-8-sig')):
  if ':live:' not in item.get('send_key',''):continue
  identifier=item.get('id') or item.get('delegate_id') or item.get('faculty_id') or item.get('reference') or item.get('sims_id') or item.get('video_id')
  key=category+'-'+str(identifier)
  if key in records:
   records[key].setdefault('historicalEmails',[]).append({'status':item.get('status','unknown'),'to':item.get('email',''),'provider':item.get('provider',''),'at':item.get('updated_at',''),'source':'Original certificate email ledger'})
output=root/'reports/certificate-portal/source-context.json'
output.write_text(json.dumps({'at':datetime.now(timezone.utc).isoformat(),'records':records},indent=2)+'\n')
print('Prepared private source context for',len(records),'certificates;',sum(bool(r.get('historicalEmails')) for r in records.values()),'with original email history.')
