// Iron Meridian — game data. All names, units and designs are original.
export const TILE = 32;            // world pixels per tile
export const TICK_RATE = 20;       // simulation ticks per second
export const DT = 1 / TICK_RATE;

export const GAME_TITLE = 'Iron Meridian';

export const FACTIONS = {
  accord: {
    name: 'Aegis Accord',
    short: 'Accord',
    desc: 'Precision technology. Beam weapons, long-range scouting and an orbital strike platform.',
    sw: 'orbital',
  },
  dominion: {
    name: 'Ember Dominion',
    short: 'Dominion',
    desc: 'Heavy industry. Thick armor, flame infantry, siege defenses and a ballistic missile silo.',
    sw: 'missile',
  },
};

export const PLAYER_COLORS = [
  { name: 'Azure', hex: '#3d9cf0' },
  { name: 'Ember', hex: '#e8553a' },
  { name: 'Jade', hex: '#4fc768' },
  { name: 'Gold', hex: '#f0c544' },
  { name: 'Violet', hex: '#a978f0' },
  { name: 'Teal', hex: '#36d3c2' },
];

// Damage multipliers by warhead vs armor class.
export const WARHEADS = {
  bullet: { inf: 1.0, light: 0.55, heavy: 0.25, bld: 0.2 },
  ap: { inf: 0.35, light: 0.85, heavy: 1.0, bld: 0.6 },
  rocket: { inf: 0.3, light: 1.0, heavy: 1.0, bld: 0.75 },
  he: { inf: 1.0, light: 0.65, heavy: 0.45, bld: 1.0 },
  beam: { inf: 0.8, light: 1.0, heavy: 0.9, bld: 0.85 },
  flame: { inf: 1.6, light: 0.6, heavy: 0.3, bld: 0.9 },
  sniper: { inf: 10, light: 0.05, heavy: 0.02, bld: 0 },
  super: { inf: 1, light: 1, heavy: 1, bld: 1 },
};

// cat: infantry | vehicle. speed/range/sight in tiles; rof in seconds; time in seconds.
export const UNITS = {
  rifle: {
    name: 'Rifleman', cat: 'infantry', cost: 100, time: 4, hp: 125, armor: 'inf', speed: 1.6, sight: 5,
    weapon: { dmg: 15, range: 4.5, rof: 1.0, wh: 'bullet', proj: 'bullet', snd: 'rifle' },
    req: ['barracks'], desc: 'Basic infantry. Effective against other infantry.',
  },
  rocket: {
    name: 'Rocket Trooper', cat: 'infantry', cost: 300, time: 7, hp: 125, armor: 'inf', speed: 1.4, sight: 6,
    weapon: { dmg: 42, range: 6, rof: 2.2, wh: 'rocket', proj: 'rocket', snd: 'rocket' },
    req: ['barracks'], desc: 'Shoulder-fired rockets. Strong against vehicles and structures.',
  },
  engineer: {
    name: 'Engineer', cat: 'infantry', cost: 500, time: 8, hp: 75, armor: 'inf', speed: 1.5, sight: 4,
    engineer: true, req: ['barracks'],
    desc: 'Captures enemy or neutral structures, repairs your own. Consumed on use.',
  },
  ranger: {
    name: 'Ranger', cat: 'infantry', cost: 1500, time: 20, hp: 220, armor: 'inf', speed: 1.8, sight: 8,
    weapon: { dmg: 200, range: 7.5, rof: 1.6, wh: 'sniper', proj: 'tracer', snd: 'sniper' },
    demo: true, unique: true, faction: 'accord', req: ['barracks', 'techlab'],
    desc: 'Elite marksman. One-shot kills on infantry. Plants demolition charges on structures. Limit 1.',
  },
  juggernaut: {
    name: 'Juggernaut', cat: 'infantry', cost: 1500, time: 20, hp: 650, armor: 'light', speed: 1.2, sight: 6,
    weapon: { dmg: 28, range: 3.5, rof: 0.35, wh: 'flame', proj: 'flame', splash: 0.9, snd: 'flame' },
    unique: true, faction: 'dominion', req: ['barracks', 'techlab'],
    desc: 'Armored flame trooper. Devastating at close range against infantry and structures. Limit 1.',
  },
  raider: {
    name: 'Raider', cat: 'vehicle', cost: 500, time: 6, hp: 260, armor: 'light', speed: 3.3, sight: 7, turn: 8,
    turret: true,
    weapon: { dmg: 13, range: 5, rof: 0.33, wh: 'bullet', proj: 'bullet', snd: 'mg' },
    req: ['factory'], desc: 'Fast scout buggy with a machine gun. Shreds infantry.',
  },
  tank: {
    name: 'Battle Tank', cat: 'vehicle', cost: 800, time: 9, hp: 460, armor: 'heavy', speed: 2.0, sight: 6, turn: 4,
    turret: true,
    weapon: { dmg: 70, range: 5.5, rof: 1.6, wh: 'ap', proj: 'shell', snd: 'cannon' },
    req: ['factory'], desc: 'Main battle tank. Solid all-rounder against armor.',
  },
  artillery: {
    name: 'Howitzer', cat: 'vehicle', cost: 950, time: 12, hp: 200, armor: 'light', speed: 1.5, sight: 6, turn: 3,
    weapon: { dmg: 110, range: 11, minRange: 3, rof: 4, wh: 'he', proj: 'arty', splash: 1.2, snd: 'arty' },
    req: ['factory', 'radar'], desc: 'Long-range siege gun. Cannot hit targets up close.',
  },
  lancer: {
    name: 'Lancer', cat: 'vehicle', cost: 1200, time: 13, hp: 400, armor: 'heavy', speed: 1.9, sight: 7, turn: 4,
    turret: true,
    weapon: { dmg: 140, range: 7, rof: 3, wh: 'beam', proj: 'beam', chain: 1, snd: 'beam' },
    faction: 'accord', req: ['factory', 'techlab'],
    desc: 'Beam tank. Its focused beam arcs to a second nearby target.',
  },
  behemoth: {
    name: 'Behemoth', cat: 'vehicle', cost: 1750, time: 16, hp: 950, armor: 'heavy', speed: 1.3, sight: 6, turn: 2.5,
    turret: true,
    weapon: { dmg: 85, range: 5.8, rof: 2, wh: 'ap', proj: 'shell', barrels: 2, snd: 'cannon' },
    selfRepair: true, faction: 'dominion', req: ['factory', 'techlab'],
    desc: 'Super-heavy twin-cannon tank. Slowly repairs itself.',
  },
  harvester: {
    name: 'Harvester', cat: 'vehicle', cost: 1400, time: 14, hp: 1000, armor: 'heavy', speed: 1.4, sight: 4, turn: 3,
    harvester: true, capacity: 700, req: ['factory', 'refinery'],
    desc: 'Collects crystal and delivers it to a Refinery. Azure crystal is worth double.',
  },
  crawler: {
    name: 'Base Crawler', cat: 'vehicle', cost: 3000, time: 30, hp: 1000, armor: 'heavy', speed: 1.0, sight: 5, turn: 2,
    deploysTo: 'hq', req: ['factory', 'depot'],
    desc: 'Mobile construction vehicle. Deploys into a Command Yard.',
  },
};

// cat: building | defense. w/h in tiles. power: + produces / - consumes.
export const BUILDINGS = {
  hq: {
    name: 'Command Yard', cat: 'building', w: 3, h: 3, hp: 2000, cost: 3000, time: 0, power: 0, sight: 7,
    buildable: false, producer: 'building', undeploysTo: 'crawler',
    desc: 'Builds all structures. Can pack up into a Base Crawler.',
  },
  power: {
    name: 'Power Plant', cat: 'building', w: 2, h: 2, hp: 750, cost: 300, time: 8, power: 100, sight: 4,
    req: [], desc: 'Provides 100 power to your base.',
  },
  refinery: {
    name: 'Refinery', cat: 'building', w: 3, h: 3, hp: 1000, cost: 2000, time: 15, power: -50, sight: 5,
    req: ['power'], refinery: true, desc: 'Processes crystal into credits. Comes with a free Harvester.',
  },
  barracks: {
    name: 'Barracks', cat: 'building', w: 2, h: 2, hp: 800, cost: 300, time: 6, power: -10, sight: 5,
    req: ['power'], producer: 'infantry', desc: 'Trains infantry.',
  },
  factory: {
    name: 'War Factory', cat: 'building', w: 3, h: 3, hp: 1500, cost: 2000, time: 18, power: -25, sight: 5,
    req: ['refinery'], producer: 'vehicle', desc: 'Builds vehicles.',
  },
  radar: {
    name: 'Uplink Array', cat: 'building', w: 2, h: 2, hp: 1000, cost: 1000, time: 12, power: -50, sight: 10,
    req: ['refinery'], radar: true, desc: 'Enables the tactical map and unlocks advanced units.',
  },
  depot: {
    name: 'Service Depot', cat: 'building', w: 3, h: 3, hp: 1200, cost: 800, time: 10, power: -20, sight: 5,
    req: ['factory'], depot: true, desc: 'Repairs vehicles parked on its pad. Unlocks the Base Crawler.',
  },
  techlab: {
    name: 'Research Center', cat: 'building', w: 3, h: 3, hp: 1500, cost: 2000, time: 20, power: -100, sight: 5,
    req: ['factory', 'radar'], desc: 'Unlocks elite units, advanced defenses and the superweapon.',
  },
  orbital: {
    name: 'Orbital Lance', cat: 'building', w: 3, h: 3, hp: 2500, cost: 5000, time: 30, power: -200, sight: 5,
    req: ['techlab'], faction: 'accord', superweapon: 'orbital', charge: 300,
    desc: 'Superweapon. Calls down a devastating orbital beam anywhere on the map.',
  },
  silo: {
    name: 'Seismic Silo', cat: 'building', w: 3, h: 3, hp: 2500, cost: 5000, time: 30, power: -200, sight: 5,
    req: ['techlab'], faction: 'dominion', superweapon: 'missile', charge: 300,
    desc: 'Superweapon. Launches a ballistic warhead with an enormous blast radius.',
  },
  wall: {
    name: 'Barrier', cat: 'defense', w: 1, h: 1, hp: 450, cost: 100, time: 1.5, power: 0, sight: 1,
    req: [], wall: true, armor: 'bld', desc: 'Concrete barrier. Blocks movement. Keeps placing until cancelled.',
  },
  sentry: {
    name: 'Sentry Post', cat: 'defense', w: 1, h: 1, hp: 550, cost: 400, time: 5, power: -10, sight: 7,
    req: ['barracks'], turret: true,
    weapon: { dmg: 16, range: 6, rof: 0.35, wh: 'bullet', proj: 'bullet', snd: 'mg' },
    desc: 'Machine-gun bunker. Strong against infantry.',
  },
  turret: {
    name: 'Gun Turret', cat: 'defense', w: 1, h: 1, hp: 800, cost: 600, time: 7, power: -20, sight: 7,
    req: ['factory'], turret: true, needsPower: true,
    weapon: { dmg: 55, range: 6.5, rof: 1.3, wh: 'ap', proj: 'shell', snd: 'cannon' },
    desc: 'Anti-armor cannon emplacement. Requires power.',
  },
  lancetower: {
    name: 'Beam Spire', cat: 'defense', w: 1, h: 1, hp: 850, cost: 1500, time: 12, power: -75, sight: 9,
    req: ['techlab'], faction: 'accord', turret: true, needsPower: true,
    weapon: { dmg: 160, range: 8, rof: 3, wh: 'beam', proj: 'beam', chain: 2, snd: 'beam' },
    desc: 'Advanced beam defense. Arcs between multiple targets. Requires power.',
  },
  bastion: {
    name: 'Siege Bastion', cat: 'defense', w: 2, h: 2, hp: 1400, cost: 1500, time: 12, power: -75, sight: 10,
    req: ['techlab'], faction: 'dominion', turret: true, needsPower: true,
    weapon: { dmg: 120, range: 10, minRange: 2, rof: 3.5, wh: 'he', proj: 'arty', splash: 1.1, snd: 'arty' },
    desc: 'Fortified mortar battery with very long range. Requires power.',
  },
  derrick: {
    name: 'Drill Rig', cat: 'building', w: 2, h: 2, hp: 700, cost: 1000, time: 0, power: 0, sight: 4,
    buildable: false, capturable: true, income: 25, incomeEvery: 3,
    desc: 'Neutral structure. Capture with an Engineer for steady income.',
  },
};

export const CATEGORIES = [
  { id: 'building', label: 'Structures', short: 'Base', producer: 'hq' },
  { id: 'defense', label: 'Defenses', short: 'Def', producer: 'hq' },
  { id: 'infantry', label: 'Infantry', short: 'Inf', producer: 'barracks' },
  { id: 'vehicle', label: 'Vehicles', short: 'Veh', producer: 'factory' },
];

export const DIFFICULTY = {
  easy: { label: 'Easy', think: 2.0, firstAttack: 420, wave: 5, waveGrow: 1, maxWave: 10, harvPerRef: 1, maxRef: 2, defenses: 2, income: 0.8, reserve: 600 },
  normal: { label: 'Normal', think: 1.0, firstAttack: 300, wave: 7, waveGrow: 2, maxWave: 16, harvPerRef: 1.5, maxRef: 3, defenses: 4, income: 1.0, reserve: 300 },
  hard: { label: 'Hard', think: 0.5, firstAttack: 210, wave: 9, waveGrow: 2, maxWave: 22, harvPerRef: 2, maxRef: 4, defenses: 6, income: 1.0, reserve: 100 },
  brutal: { label: 'Brutal', think: 0.35, firstAttack: 160, wave: 10, waveGrow: 3, maxWave: 28, harvPerRef: 2, maxRef: 4, defenses: 8, income: 1.3, reserve: 0 },
};

export const RANK_NAMES = ['Rookie', 'Veteran', 'Elite'];
export const RANKS = [
  { dmg: 1, rof: 1, armor: 1, heal: 0 },
  { dmg: 1.2, rof: 0.9, armor: 0.85, heal: 0 },
  { dmg: 1.45, rof: 0.8, armor: 0.7, heal: 0.01 },
];

export function unitRadius(type) {
  const d = UNITS[type];
  if (!d) return 8;
  if (d.cat === 'infantry') return type === 'juggernaut' ? 7 : 5;
  if (type === 'behemoth' || type === 'crawler' || type === 'harvester') return 14;
  if (type === 'raider') return 10;
  return 12;
}
