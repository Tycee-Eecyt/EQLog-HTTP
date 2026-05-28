const CLASS_CONFIG = {
  enchanter: { label: 'Enchanter', abbreviation: 'ENC', category: 'Casters', color: 0xc48cff, marker: '🧠', priority: true },
  magician: { label: 'Magician', abbreviation: 'MAG', category: 'Casters', color: 0xff7a3a, marker: '🔥', priority: false },
  necromancer: { label: 'Necromancer', abbreviation: 'NEC', category: 'Casters', color: 0x60b090, marker: '☠️', priority: false },
  wizard: { label: 'Wizard', abbreviation: 'WIZ', category: 'Casters', color: 0x8a6aff, marker: '🔮', priority: true },
  cleric: { label: 'Cleric', abbreviation: 'CLR', category: 'Priests', color: 0xe8d870, marker: '✨', priority: true },
  druid: { label: 'Druid', abbreviation: 'DRU', category: 'Priests', color: 0x40d080, marker: '🌿', priority: false },
  shaman: { label: 'Shaman', abbreviation: 'SHM', category: 'Priests', color: 0xa06ae8, marker: '🌀', priority: false },
  bard: { label: 'Bard', abbreviation: 'BRD', category: 'Melee', color: 0x54c7ec, marker: '🎵', priority: false },
  monk: { label: 'Monk', abbreviation: 'MNK', category: 'Melee', color: 0xd49a58, marker: '👊', priority: false },
  ranger: { label: 'Ranger', abbreviation: 'RNG', category: 'Melee', color: 0x5abf5a, marker: '🏹', priority: false },
  rogue: { label: 'Rogue', abbreviation: 'ROG', category: 'Melee', color: 0xd86adf, marker: '🗡️', priority: false },
  paladin: { label: 'Paladin', abbreviation: 'PAL', category: 'Tanks', color: 0xf0d0b0, marker: '🛡️', priority: false },
  'shadow-knight': { label: 'Shadow Knight', abbreviation: 'SHD', category: 'Tanks', color: 0x8888cc, marker: '💀', priority: false },
  warrior: { label: 'Warrior', abbreviation: 'WAR', category: 'Tanks', color: 0xe06060, marker: '⚔️', priority: true },
  unknown: { label: 'Unknown', abbreviation: 'UNK', category: 'Other', color: 0x7d86ad, marker: '•', priority: false },
};

const CLASS_ORDER = Object.keys(CLASS_CONFIG);
const CLASS_GROUPS = ['Casters', 'Priests', 'Melee', 'Tanks'];
const PRIORITY_CLASSES = CLASS_ORDER.filter((className) => CLASS_CONFIG[className].priority);

function inferClass(record) {
  const name = String(record.character || record.name || '').toLowerCase();
  const zone = String(record.zone || '').toLowerCase();

  if (/heal|cleric|clr|rez|doctor/.test(name)) return 'cleric';
  if (/wiz|port|nuke|evac|coth/.test(name)) return 'wizard';
  if (/war|tank|shield/.test(name)) return 'warrior';
  if (/ench|chanter|enc|mez|clarity/.test(name)) return 'enchanter';
  if (/mage|mag|mod|call/.test(name)) return 'magician';
  if (/dru|track|snare|gather/.test(name)) return 'druid';
  if (/sham|slow|shm/.test(name)) return 'shaman';
  if (/bard|brd|song/.test(name)) return 'bard';
  if (/monk|mnk|pull/.test(name)) return 'monk';
  if (/ranger|rng|snipe/.test(name)) return 'ranger';
  if (/rogue|rog|stab/.test(name)) return 'rogue';
  if (/paladin|pal/.test(name)) return 'paladin';
  if (/sk|shadow/.test(name)) return 'shadow-knight';
  if (/necro|nec|corpse/.test(name) || zone.includes('paineel') || zone.includes('neriak')) return 'necromancer';
  return 'unknown';
}

function getClassConfig(className) {
  return CLASS_CONFIG[className] || CLASS_CONFIG.unknown;
}

function formatClass(className) {
  return getClassConfig(className).label;
}

function classSortValue(className) {
  const index = CLASS_ORDER.indexOf(className);
  return index === -1 ? CLASS_ORDER.length : index;
}

function sortBots(a, b) {
  const aClass = a.className || inferClass(a);
  const bClass = b.className || inferClass(b);
  const aPriority = getClassConfig(aClass).priority ? 0 : 1;
  const bPriority = getClassConfig(bClass).priority ? 0 : 1;

  if (aPriority !== bPriority) return aPriority - bPriority;
  if (classSortValue(aClass) !== classSortValue(bClass)) return classSortValue(aClass) - classSortValue(bClass);
  return String(a.character || a.name || '').localeCompare(String(b.character || b.name || ''));
}

module.exports = {
  CLASS_CONFIG,
  CLASS_ORDER,
  CLASS_GROUPS,
  PRIORITY_CLASSES,
  inferClass,
  getClassConfig,
  formatClass,
  sortBots,
};
