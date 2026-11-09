// Local UI preview only: fictitious records, no database, storage or outbound mail.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const app = express();
app.use(express.json());
app.get('/api/certificates/config', (req, res) => res.json({ enabled: true }));
app.get('/api/certificates/search', (req, res) => res.json({ people: /ananya|demo|0123/i.test(req.query.q || '') ? [{ name: 'Dr. Ananya Rao', certificates: [
  { id: 'demo-conference-123', name: 'Dr. Ananya Rao', registrationNumber: 'AOA2026-0123', category: 'conference', role: 'Faculty', title: 'AOACON 2026 Conference' },
  { id: 'demo-workshop-123', name: 'Dr. Ananya Rao', registrationNumber: 'AOA2026-0123', category: 'pocus', role: 'Delegate', title: 'Obstetric PoCUS Workshop' },
] }] : [] }));
app.post('/api/certificates/queries', (req, res) => res.status(201).json({ reference: 'PREVIEW-ONLY', message: 'Preview: your query form works. Nothing was saved or emailed.' }));
app.use('/api', (req, res) => res.status(400).json({ message: 'Local preview only. Downloads, login and sending emails are disabled.' }));
app.use('/certificates', express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/certificates')));
app.get('/', (req, res) => res.redirect('/certificates/'));
app.listen(4177, '127.0.0.1', () => console.log('Local preview: http://127.0.0.1:4177/certificates/ — search Ananya. No real email or database access.'));
