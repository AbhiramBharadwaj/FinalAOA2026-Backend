const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
async function api(path, options) {
  const response = await fetch(`/api/certificates${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Please try again later.');
  return data;
}
function notice(message, error = false) { $('notice').textContent = message; $('notice').className = `notice${error ? ' error' : ''}`; $('notice').hidden = !message; }
function openQuery(certificate) {
  $('query-form').reset(); $('query-feedback').textContent = '';
  $('query-certificate').value = certificate?.id || '';
  if (certificate) { $('query-name').value = certificate.name; $('query-registration').value = certificate.registrationNumber; $('query-issue').value = 'role'; }
  else if ($('search').value.trim() && !/\d/.test($('search').value)) $('query-name').value = $('search').value.trim();
  $('query-dialog').showModal();
}
let selected, emailRequestId;
function openEmail(certificate) {
  selected = certificate; emailRequestId = crypto.randomUUID(); $('email-form').reset();
  $('email-feedback').textContent = ''; $('email-description').textContent = `${certificate.name} · ${certificate.title} · ${certificate.role}`;
  $('email-dialog').showModal();
}
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
$('open-query').addEventListener('click', () => openQuery());
$('search-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('search-button'); button.disabled = true; button.textContent = 'Searching…'; notice(''); $('results').replaceChildren();
  try {
    const data = await api(`/search?q=${encodeURIComponent($('search').value.trim())}`);
    if (!data.people.length) {
      const empty = node('div', '', 'empty'); empty.append(node('h2', 'No record found for the details entered.'), node('p', 'Please check your spelling or registration number. If you attended AOACON 2026, submit a query so our team can help.'));
      const btn = node('button', 'Submit a query', 'secondary'); btn.onclick = () => openQuery(); empty.append(btn); $('results').append(empty);
    }
    for (const person of data.people) {
      const section = node('section', '', 'result-person'), heading = node('div', '', 'person-heading');
      heading.append(node('h2', person.name), node('span', `${person.certificates.length} certificate${person.certificates.length === 1 ? '' : 's'}`, 'hint')); section.append(heading);
      const cards = node('div', '', 'cards');
      for (const certificate of person.certificates) {
        const card = node('article', '', 'certificate-card'); card.append(node('span', certificate.role, 'badge'), node('h3', certificate.title));
        if (certificate.registrationNumber) card.append(node('p', `Registration ${certificate.registrationNumber}`, 'hint'));
        const actions = node('div', '', 'card-actions'), download = node('button', 'Download'), email = node('button', 'Send by email', 'secondary');
        download.onclick = async () => { download.disabled = true; try { const { url } = await api(`/${certificate.id}/download`); const a = node('a'); a.href = url; a.rel = 'noopener'; a.target = '_blank'; a.click(); } catch (e) { notice(e.message, true); } finally { download.disabled = false; } };
        email.onclick = () => openEmail(certificate); actions.append(download, email); card.append(actions);
        const correction = node('button', 'Report a correction for this certificate', 'text-button'); correction.onclick = () => openQuery(certificate); card.append(correction); cards.append(card);
      }
      section.append(cards); $('results').append(section);
    }
    if (data.truncated) notice('More matches are available. Add your surname or use your registration number to narrow the search.');
    $('results').focus({ preventScroll: true });
  } catch (e) { notice(e.message, true); }
  finally { button.disabled = false; button.textContent = 'Find certificates ↗'; }
});
$('email-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  const email = $('delivery-email').value.trim();
  try {
    const result = await api(`/${selected.id}/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, requestId: emailRequestId }) });
    $('email-feedback').textContent = result.message;
  } catch (e) { $('email-feedback').textContent = e.message; }
  finally { button.disabled = false; }
});
$('query-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    const result = await api('/queries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    $('query-dialog').close(); notice(`${result.message} Reference: ${result.reference}`);
  } catch (e) { $('query-feedback').textContent = e.message; }
  finally { button.disabled = false; }
});
api('/config').then(config => { if (!config.enabled) { notice('The certificate portal is being prepared. Please check back soon.'); $('search-button').disabled = true; $('open-query').disabled = true; } }).catch(() => notice('The portal is temporarily unavailable. Please try again later.', true));
