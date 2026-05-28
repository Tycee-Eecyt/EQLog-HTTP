const searchInput = document.querySelector('#discord-search');
const refreshButton = document.querySelector('#discord-refresh');
const filterButtonsContainer = document.querySelector('#class-filter-buttons');
const legend = document.querySelector('#class-legend');
const body = document.querySelector('#discord-bots-body');
const botCount = document.querySelector('#discord-bot-count');
const zoneCount = document.querySelector('#discord-zone-count');
const readyCount = document.querySelector('#discord-ready-count');

let bots = [];
let activeClass = 'all';

const CLASS_CONFIG = {
  enchanter: { label: 'Enchanter', abbreviation: 'ENC', category: 'Casters' },
  magician: { label: 'Magician', abbreviation: 'MAG', category: 'Casters' },
  necromancer: { label: 'Necromancer', abbreviation: 'NEC', category: 'Casters' },
  wizard: { label: 'Wizard', abbreviation: 'WIZ', category: 'Casters' },
  cleric: { label: 'Cleric', abbreviation: 'CLR', category: 'Priests' },
  druid: { label: 'Druid', abbreviation: 'DRU', category: 'Priests' },
  shaman: { label: 'Shaman', abbreviation: 'SHM', category: 'Priests' },
  bard: { label: 'Bard', abbreviation: 'BRD', category: 'Melee' },
  monk: { label: 'Monk', abbreviation: 'MNK', category: 'Melee' },
  ranger: { label: 'Ranger', abbreviation: 'RNG', category: 'Melee' },
  rogue: { label: 'Rogue', abbreviation: 'ROG', category: 'Melee' },
  paladin: { label: 'Paladin', abbreviation: 'PAL', category: 'Tanks' },
  'shadow-knight': { label: 'Shadow Knight', abbreviation: 'SHD', category: 'Tanks' },
  warrior: { label: 'Warrior', abbreviation: 'WAR', category: 'Tanks' },
  unknown: { label: 'Unknown', abbreviation: 'UNK', category: 'Other' },
};
const CLASS_ORDER = Object.keys(CLASS_CONFIG);
const CLASS_GROUPS = ['Casters', 'Priests', 'Melee', 'Tanks'];

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
  if (/ench|chanter|enc|mez|clarity/.test(name)) return 'enchanter';
  if (/mage|mag|mod/.test(name)) return 'magician';
  if (/dru|track|snare/.test(name)) return 'druid';
  if (/sham|slow|shm/.test(name)) return 'shaman';
  if (/bard|brd|song/.test(name)) return 'bard';
  if (/monk|mnk|pull/.test(name)) return 'monk';
  if (/ranger|rng/.test(name)) return 'ranger';
  if (/rogue|rog|stab/.test(name)) return 'rogue';
  if (/paladin|pal/.test(name)) return 'paladin';
  if (/sk|shadow/.test(name)) return 'shadow-knight';
  if (/necro|nec/.test(name) || zone.includes('paineel')) return 'necromancer';
  return 'unknown';
}

function formatClass(className) {
  return CLASS_CONFIG[className]?.label || CLASS_CONFIG.unknown.label;
}

function formatClassWithAbbreviation(className) {
  const config = CLASS_CONFIG[className] || CLASS_CONFIG.unknown;
  return `${config.label} ${config.abbreviation}`;
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
    className: record.className || inferClass(record),
    classLabel: record.classLabel || formatClass(record.className || inferClass(record)),
    classAbbreviation: record.classAbbreviation || CLASS_CONFIG[record.className || inferClass(record)]?.abbreviation || 'UNK',
    classCategory: record.classCategory || CLASS_CONFIG[record.className || inferClass(record)]?.category || 'Other',
    ready: Boolean(record.ready || (record.zone && record.zone !== 'Unknown')),
  };
}

function renderClassControls() {
  filterButtonsContainer.innerHTML = [
    '<button type="button" class="active" data-class="all">All</button>',
    ...CLASS_ORDER
      .filter((className) => className !== 'unknown')
      .map((className) => `<button type="button" data-class="${escapeHtml(className)}">${escapeHtml(CLASS_CONFIG[className].abbreviation)}</button>`),
  ].join('');

  legend.innerHTML = CLASS_GROUPS.map((group) => {
    const classes = CLASS_ORDER.filter((className) => CLASS_CONFIG[className].category === group);
    return `
      <div class="class-legend-group">
        <strong>${escapeHtml(group)}</strong>
        ${classes.map((className) => `<span class="class-chip ${escapeHtml(className)}">${escapeHtml(formatClassWithAbbreviation(className))}</span>`).join('')}
      </div>
    `;
  }).join('');
}

function sortBots(a, b) {
  const aClass = CLASS_ORDER.indexOf(a.className);
  const bClass = CLASS_ORDER.indexOf(b.className);
  const aIndex = aClass === -1 ? CLASS_ORDER.length : aClass;
  const bIndex = bClass === -1 ? CLASS_ORDER.length : bClass;
  if (aIndex !== bIndex) return aIndex - bIndex;
  return String(a.character || '').localeCompare(String(b.character || ''));
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
  const ready = bots.filter((record) => record.ready).length;

  botCount.textContent = bots.length;
  zoneCount.textContent = uniqueZones.size;
  readyCount.textContent = ready;
}

function renderBots() {
  renderStats();

  const filteredBots = getFilteredBots();
  if (!filteredBots.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">No Safe bots match this view.</td></tr>';
    return;
  }

  body.innerHTML = filteredBots.map((record) => `
    <tr>
      <td><strong class="safe-name">${escapeHtml(record.character)}</strong></td>
      <td><span class="class-chip ${escapeHtml(record.className)}" title="${record.classSource === 'manual' ? 'Manually assigned' : 'Inferred from name'}">${escapeHtml(record.classLabel || formatClass(record.className))} ${escapeHtml(record.classAbbreviation || '')}</span></td>
      <td>${escapeHtml(record.server || 'Unknown')}</td>
      <td><span class="zone-pill">${escapeHtml(record.zone || 'Unknown')}</span></td>
      <td><span class="status-pill ${record.ready ? 'ready' : 'unknown'}">${record.ready ? 'Parked' : 'Unknown'}</span></td>
      <td>${escapeHtml(formatAge(record.enteredAt))}</td>
      <td>${escapeHtml(formatDate(record.enteredAt))}</td>
    </tr>
  `).join('');
}

async function loadBots() {
  refreshButton.disabled = true;
  body.innerHTML = '<tr><td colspan="7" class="empty">Loading Safe bot roster...</td></tr>';

  try {
    const data = await fetchJson('/api/discord/bots');
    bots = (data.records || []).map(decorateBot).sort(sortBots);
    renderBots();
  } catch (error) {
    body.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(error.message)}</td></tr>`;
  } finally {
    refreshButton.disabled = false;
  }
}

searchInput.addEventListener('input', renderBots);
refreshButton.addEventListener('click', loadBots);

renderClassControls();

filterButtonsContainer.addEventListener('click', (event) => {
  const button = event.target.closest('[data-class]');
  if (!button) return;

  activeClass = button.dataset.class;
  filterButtonsContainer.querySelectorAll('[data-class]').forEach((candidate) => {
    candidate.classList.toggle('active', candidate === button);
  });
  renderBots();
});

loadBots();
setInterval(loadBots, 60000);
