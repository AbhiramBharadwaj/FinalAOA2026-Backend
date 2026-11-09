const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
let token = '', tab = 'queries', page = 1;
const notice = message => { $('notice').textContent = message; $('notice').hidden = !message; };
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Request failed.'); return data;
}
const api = (path, options) => request(`/api/certificates/admin${path}`, options);
const json = body => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function field(form, label, name, value, type = 'text') {
  const box = el('div'), id = crypto.randomUUID(), lab = el('label', label); lab.htmlFor = id;
  const input = el(type === 'textarea' ? 'textarea' : 'input'); input.id = id; input.name = name;
  if (type !== 'textarea') input.type = type; if (type !== 'file') input.value = value || '';
  box.append(lab, input); form.append(box); return input;
}
async function perform(button, action) { button.disabled = true; try { await action(); } catch (e) { notice(e.message); } finally { button.disabled = false; } }
async function load() {
  $('items').replaceChildren(); notice(''); $('status').hidden = tab !== 'queries'; $('filter').hidden = tab !== 'certificates';
  document.querySelector('label[for=status]').hidden = tab !== 'queries'; $('next').hidden = true; $('previous').hidden = true;
  try {
    const data = await api(tab === 'queries' ? `/queries?status=${$('status').value}&page=${page}` : tab === 'certificates' ? `/certificates?q=${encodeURIComponent($('filter').value.trim())}` : '/deliveries');
    $('count').textContent = tab === 'queries' ? `${data.total} requests · Page ${page}` : `${data.items.length} most recent matches`;
    if (!data.items.length) $('items').append(el('div', 'No records to show.', 'empty'));
    if (tab === 'certificates') {
      const panel = el('details', undefined, 'admin-item'); panel.append(el('summary', 'Add an approved certificate / resolve a missing record'));
      const form = el('form'), grid = el('div', undefined, 'form-grid');
      field(grid, 'Recipient name', 'name', '').required = true; field(grid, 'Contact email', 'email', '', 'email').required = true;
      field(grid, 'Role', 'role', 'Delegate').required = true; field(grid, 'Event / presentation title', 'title', '').required = true;
      field(grid, 'Registration number (optional)', 'registrationNumber', ''); field(grid, 'Medical council number (optional)', 'councilNumber', ''); form.append(grid);
      const categoryLabel = el('label', 'Certificate category'), category = el('select'); category.name = 'category'; category.setAttribute('aria-label', 'Certificate category');
      for (const [value, title] of [['conference', 'Conference'], ['critical-incidents', 'Critical Incidents'], ['pocus', 'Obstetric PoCUS'], ['maternal', 'Maternal Resuscitation'], ['labour', 'Labour Analgesia'], ['occc', 'Certified Critical Care'], ['presentation', 'Paper / poster presentation'], ['video-award', 'Video award']]) { const option = el('option', title); option.value = value; category.append(option); } form.append(categoryLabel, category);
      const file = field(form, 'Approved certificate', 'file', '', 'file'); file.required = true; file.accept = '.png,.jpg,.jpeg,.pdf';
      const publishLabel = el('label', 'Publish in the portal'), publish = el('input'); publish.type = 'checkbox'; publish.style.width = 'auto'; publishLabel.prepend(publish); form.append(publishLabel);
      field(form, 'Approval note', 'note', '', 'textarea').required = true; const save = el('button', 'Add certificate'); form.append(save);
      form.onsubmit = event => { event.preventDefault(); perform(save, async () => { const body = new FormData(form); body.set('published', String(publish.checked)); await api('/certificates', { method: 'POST', body }); await load(); notice('Approved certificate added. No email sent.'); }); }; panel.append(form); $('items').prepend(panel);
    }
    for (const row of data.items) {
      const card = el('article', undefined, 'admin-item');
      if (tab === 'queries') {
        card.append(el('span', row.status.replace('_', ' '), 'pill'), el('h3', `${row.reference} · ${row.name}`), el('p', `${row.email}${row.phone ? ' · ' + row.phone : ''}`, 'meta'), el('p', `${row.issue} · Registration: ${row.registrationNumber || 'Not supplied'}`, 'meta'), el('pre', row.remarks));
        if (row.certificateId) card.append(el('p', `Certificate: ${row.certificateId}`, 'meta'));
        const form = el('form'), select = el('select'); select.setAttribute('aria-label', 'Request status');
        for (const s of ['new', 'in_review', 'resolved']) { const o = el('option', s.replace('_', ' ')); o.value = s; select.append(o); } select.value = row.status; form.append(select);
        const note = field(form, 'Response / resolution', 'resolution', row.resolution, 'textarea'); note.maxLength = 3000;
        const actions = el('div', undefined, 'card-actions'), save = el('button', 'Save status'), notify = el('button', 'Email saved response', 'secondary'); notify.type = 'button';
        notify.onclick = () => perform(notify, async () => { await api(`/queries/${row.reference}/notify`, { method: 'POST' }); notice('Email update accepted by the provider.'); });
        actions.append(save, notify); form.append(actions);
        form.onsubmit = event => { event.preventDefault(); perform(save, async () => { await api(`/queries/${row.reference}`, { method: 'PUT', ...json({ status: select.value, resolution: note.value }) }); await load(); notice('Request updated.'); }); };
        card.append(form); const details = el('details'), summary = el('summary', 'Request history'); details.append(summary);
        for (const h of row.history || []) details.append(el('p', `${new Date(h.at).toLocaleString()} · ${h.actor || 'Organiser'} · ${h.status} · ${h.note}`, 'meta')); card.append(details);
      } else if (tab === 'certificates') {
        card.append(el('span', row.published ? 'Published' : 'Hidden', 'pill'), el('h3', row.name), el('p', `${row.title} · ${row.role}`, 'meta'), el('p', `${row.email} · ${row.publicId}`, 'meta'));
        const preview = el('button', 'View certificate', 'secondary'); preview.onclick = () => perform(preview, async () => { const { url } = await api(`/certificates/${row.publicId}/download`); window.open(url, '_blank', 'noopener'); }); card.append(preview);
        const form = el('form'), grid = el('div', undefined, 'form-grid'); field(grid, 'Name on certificate', 'name', row.name).required = true; field(grid, 'Role on certificate', 'role', row.role).required = true; field(grid, 'Registered email', 'email', row.email, 'email').required = true;
        const publishLabel = el('label', 'Make available in the portal'), publish = el('input'); publish.type = 'checkbox'; publish.checked = row.published; publish.style.width = 'auto'; publishLabel.prepend(publish); grid.append(publishLabel); form.append(grid);
        const file = field(form, 'Corrected certificate (required for name or role changes)', 'file', '', 'file'); file.accept = '.png,.jpg,.jpeg,.pdf';
        field(form, 'Change note', 'note', '', 'textarea').required = true;
        const save = el('button', 'Save correction'); form.append(save); form.onsubmit = event => { event.preventDefault(); perform(save, async () => { const body = new FormData(form); if (!file.files.length) body.delete('file'); body.set('published', String(publish.checked)); await api(`/certificates/${row.publicId}`, { method: 'PUT', body }); await load(); notice('Certificate updated. The original remains in private storage for audit.'); }); }; card.append(form);
      } else { card.append(el('span', row.status, 'pill'), el('h3', row.to), el('p', `Certificate ${row.certificateId}`, 'meta'), el('p', `${new Date(row.createdAt).toLocaleString()} · ${row.provider || 'Provider not confirmed'} · ${row.messageId || ''}`, 'meta')); }
      $('items').append(card);
    }
    if (tab === 'queries') { $('next').hidden = page * 30 >= data.total; $('previous').hidden = page === 1; }
  } catch (e) { notice(e.message); }
}
$('login').onsubmit = event => { event.preventDefault(); const button = event.submitter; perform(button, async () => { const data = await request('/api/auth/admin/login', { method: 'POST', ...json({ email: $('admin-email').value, password: $('admin-password').value }) }); token = data.token; if (!token) throw new Error('Admin sign-in did not return a session.'); $('admin-password').value = ''; $('login').hidden = true; $('workspace').hidden = false; $('logout').hidden = false; await load(); }); };
$('logout').onclick = () => { token = ''; $('workspace').hidden = true; $('items').replaceChildren(); $('login').hidden = false; $('logout').hidden = true; notice(''); };
document.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { tab = b.dataset.tab; page = 1; document.querySelectorAll('[data-tab]').forEach(x => x.className = x === b ? '' : 'secondary'); load(); }; });
$('refresh').onclick = () => load(); $('status').onchange = () => { page = 1; load(); };
$('filter').onkeydown = event => { if (event.key === 'Enter') load(); };
$('previous').onclick = () => { page--; load(); }; $('next').onclick = () => { page++; load(); };
