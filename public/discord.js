const searchInput = document.querySelector('#discord-search');
const refreshButton = document.querySelector('#discord-refresh');
const filterButtons = [...document.querySelectorAll('[data-class]')];
const body = document.querySelector('#discord-bots-body');
const botCount = document.querySelector('#discord-bot-count');
const zoneCount = document.querySelector('#discord-zone-count');
const readyCount = document.querySelector('#discord-ready-count');

let bots = [];
let activeClass = 'all';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed with ${response.status}`);
  }
  return response.json();
}

function inferClass(record) {
  const name = String(record.character || '').toLowerCase();
  const zone = String(record.zone || '').toLowerCase();

  if (/heal|cleric|clr|rez/.test(name)) return 'cleric';
  if (/wiz|port|evac/.test(name)) return 'wizard';
  if (/war|tank/.test(name)) return 'warrior';
  if (/mage|mag|mod/.test(name)) return 'magician';
  if (/dru|track|snare/.test(name)) return 'druid';
  if (/sham|slow|shm/.test(name)) return 'shaman';
  if (/ranger|rng/.test(name)) return 'ranger';
  if (/paladin|pal/.test(name)) return 'paladin';
  if (/sk|shadow/.test(name)) return 'shadow-knight';
  if (/necro|nec/.test(name) || zone.includes('paineel')) return 'necromancer';
  return 'unknown';
}

function formatClass(className) {
  return className
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatAge(value) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'Unknown';

  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

function decorateBot(record) {
  return {
    ...record,
    className: inferClass(record),
  };
}

function getFilteredBots() {
  const query = searchInput.value.trim().toLowerCase();

  return bots.filter((record) => {
    if (activeClass !== 'all' && record.className !== activeClass) return false;
    if (!query) return true;

    return [
      record.character,
      record.server,
      record.zone,
      record.className,
    ].some((value) => String(value || '').toLowerCase().includes(query));
  });
}

function renderStats() {
  const uniqueZones = new Set(bots.map((record) => record.zone).filter(Boolean));
  const ready = bots.filter((record) => record.zone && record.zone !== 'Unknown').length;

  botCount.textContent = bots.length;
  zoneCount.textContent = uniqueZones.size;
  readyCount.textContent = ready;
}

function renderBots() {
  renderStats();

  const filteredBots = getFilteredBots();
  if (!filteredBots.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">No Safe bots match this view.</td></tr>';
    return;
  }

  body.innerHTML = filteredBots.map((record) => `
    <tr>
      <td><strong class="safe-name">${escapeHtml(record.character)}</strong></td>
      <td><span class="class-chip ${escapeHtml(record.className)}">${escapeHtml(formatClass(record.className))}</span></td>
      <td>${escapeHtml(record.server || 'Unknown')}</td>
      <td><span class="zone-pill">${escapeHtml(record.zone || 'Unknown')}</span></td>
      <td>${escapeHtml(formatAge(record.enteredAt))}</td>
      <td>${escapeHtml(formatDate(record.enteredAt))}</td>
    </tr>
  `).join('');
}

async function loadBots() {
  refreshButton.disabled = true;
  body.innerHTML = '<tr><td colspan="6" class="empty">Loading Safe bot roster...</td></tr>';

  try {
    const data = await fetchJson('/api/discord/bots');
    bots = (data.records || []).map(decorateBot);
    renderBots();
  } catch (error) {
    body.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(error.message)}</td></tr>`;
  } finally {
    refreshButton.disabled = false;
  }
}

searchInput.addEventListener('input', renderBots);
refreshButton.addEventListener('click', loadBots);

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activeClass = button.dataset.class;
    filterButtons.forEach((candidate) => candidate.classList.toggle('active', candidate === button));
    renderBots();
  });
});

loadBots();
setInterval(loadBots, 60000);
