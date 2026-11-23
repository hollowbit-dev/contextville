// Street life: walk up to anything, press E, and buy, eat or do something there.
// Each thing can be done once per building per day, and street rewards have a daily limit, so
// they're a nice extra on top of the tokens Claude writes. Eras and unlocks still count Claude's only.
import { BY_ID, CATALOG } from './catalog.js';

// New cities get a smaller allowance, so street rewards never outrun what Claude actually wrote.
export const dailyLimit = (earned) => Math.max(3000, Math.min(20000, Math.round((earned * 0.02) / 100) * 100));

export const ITEMS = {
  crisps: { name: 'Crisps', cost: 40, tokens: 300, verb: 'crunch' },
  mealdeal: { name: 'Meal deal', cost: 100, tokens: 1000, verb: 'eat' },
  fizz: { name: 'Fizzy drink', cost: 60, tokens: 150, speed: 45, verb: 'drink', note: 'Run faster for 45s' },
  coffee: { name: 'Flat white', cost: 60, tokens: 200, speed: 90, verb: 'drink', note: 'Run faster for 90s' },
  cake: { name: 'Slice of cake', cost: 90, tokens: 800, verb: 'eat' },
  croissant: { name: 'Croissant', cost: 80, tokens: 700, verb: 'eat' },
  sourdough: { name: 'Sourdough loaf', cost: 150, tokens: 1400, verb: 'eat' },
  peach: { name: 'Peach', cost: 50, tokens: 450, verb: 'eat' },
  cheese: { name: 'Wedge of cheese', cost: 200, tokens: 1800, verb: 'eat' },
  popcorn: { name: 'Popcorn', cost: 70, tokens: 600, verb: 'crunch' },
  apple: { name: 'Apple', cost: 0, tokens: 150, verb: 'eat' },
  candyfloss: { name: 'Candyfloss', cost: 80, tokens: 500, jump: 60, verb: 'eat', note: 'Jump higher for 60s' },
};

const buy = (item) => ({ id: item, item });
const act = (id, label, tokens, text, extra = {}) => ({ id, label, tokens, text, ...extra });
const OFFERS = {
  shop: [buy('mealdeal'), buy('crisps'), buy('fizz')],
  cafe: [buy('coffee'), buy('cake')],
  bakery: [buy('croissant'), buy('sourdough')],
  market: [buy('peach'), buy('cheese')],
  cinema: [buy('popcorn'), act('film', 'Watch tonight\'s film', 500, 'Two hours of long diffs. You cried at the merge.', { cost: 50 })],
  windmill: [act('grind', 'Help grind the flour', 300, 'Your arms hurt, but the bakers are grateful.')],
  office: [act('meet', 'Sit through a meeting', 300, 'It could have been an email. You were paid anyway.')],
  cache: [act('rummage', 'Rummage through the shelves', 250, 'You found something you used recently.')],
  studio: [act('playtest', 'Playtest a new game', 450, 'You found three bugs and a very good jump.')],
  datacenter: [act('reboot', 'Turn it off and on again', 600, 'It worked. Nobody knows why.')],
  campus: [act('task', 'Pick up a small task', 700, 'Handled before lunch.')],
  exchange: [act('ticker', 'Watch the numbers go by', 900, 'Everyone shouted very politely. You nodded and got a tip.')],
  post: [act('letter', 'Post a letter', 200, 'Second class, but with feeling.', { cost: 20 })],
  firehouse: [act('pole', 'Slide down the pole', 250, 'Your legs feel springy.', { jump: 45 })],
  library: [act('read', 'Read for a while', 400, 'You learned something you can\'t stop telling people.')],
  school: [act('lesson', 'Sit in on a lesson', 350, 'Learning by example. Lots of examples.')],
  clinic: [act('checkup', 'Get a check-up', 200, 'Very good tea. You feel lighter on your feet.', { speed: 60 })],
  hall: [act('grant', 'Collect a civic grant', 500, 'Stamped, signed and handed over.')],
  museum: [act('tour', 'Tour the off-by-one room', 800, 'There were either nine exhibits or eleven.', { cost: 40 })],
  university: [act('lecture', 'Attend a lecture', 900, 'You showed your working.')],
  opera: [act('opera', 'See the third act', 1200, 'The merge conflict was never resolved. Beautiful.', { cost: 100 })],
  tree: [act('shake', 'Shake the tree', 60, 'A few leaves, one surprised bird, and a coin.')],
  grove: [act('forage', 'Forage in the ferns', 100, 'You found something shiny under the leaves.')],
  flowers: [act('smell', 'Smell the flowers', 60, 'Somebody really does water these every morning.')],
  orchard: [buy('apple'), act('pick', 'Help with the harvest', 200, 'A full basket, and only slightly bruised.')],
  allotment: [act('weed', 'Pull some weeds', 150, 'The marrows look at you with respect.')],
  park: [act('picnic', 'Have a picnic', 250, 'Perfect weather for doing nothing.')],
  pond: [act('ducks', 'Feed the ducks', 200, 'They have opinions about your bread.')],
  fountain: [act('wish', 'Throw in a coin', 400, 'You made a wish. Ship it.', { cost: 10 })],
  playground: [act('swing', 'Have a go on the swings', 150, 'You went very high. You feel bouncy.', { jump: 45 })],
  lanternwalk: [act('stroll', 'Walk under the lanterns', 120, 'Slowly, the way they\'re meant to be walked.')],
  gardens: [act('glasshouse', 'Visit the glasshouse', 600, 'So many long Latin names.')],
  treehouses: [act('climb', 'Climb the ladder', 350, 'The squirrels let you stay for a minute.')],
  palm: [act('coconut', 'Shake down a coconut', 90, 'It missed you. Barely.')],
  parasol: [act('sunbathe', 'Lie in the shade', 80, 'You almost fell asleep.')],
  sandcastle: [act('moat', 'Dig a moat', 70, 'A fine defensive position, until high tide.')],
  pinewood: [act('hike', 'Wander into the woods', 180, 'It smells like Christmas in there.')],
  boulder: [act('climb', 'Climb on top', 50, 'You can see slightly more now.', { jump: 20 })],
  ferns: [act('rustle', 'Look under the ferns', 60, 'A very small frog looked back.')],
  lamppost: [act('lean', 'Lean on it thoughtfully', 30, 'You look like you\'re in a film.')],
  bench: [act('sit', 'Sit and think about it', 60, 'You thought about it.')],
  monument: [act('respect', 'Read the plaque', 150, 'A good project. It started small too.')],
  statue: [act('polish', 'Polish the spark', 300, 'It gleams. Passers-by approve.')],
  clocktower: [act('wind', 'Wind the clock', 450, 'Always exactly one more minute.')],
  lighthouse: [act('lamp', 'Light the lamp', 350, 'Late-night ideas can find their way home.')],
  tower: [act('view', 'Take the lift to the top', 600, 'It thought about the answer before showing you the view.')],
  observatory: [act('stars', 'Look through the telescope', 700, 'Further than the context window.')],
  ferris: [buy('candyfloss'), act('ride', 'Ride the Big Wheel', 800, 'You could see everything you built.', { cost: 60 })],
  carousel: [buy('candyfloss'), act('spin', 'Ride the carousel', 500, 'Round and round, happily.', { cost: 30 })],
  stadium: [act('match', 'Watch the match', 900, 'Sold out, and somehow you got in.', { cost: 80 })],
  airport: [act('planes', 'Watch the planes', 400, 'You guessed where every one of them was going.')],
  rocket: [act('launch', 'Press the big button', 1500, 'Something big must have shipped.', { fx: 'rocket' })],
  archive: [act('archive', 'Look up an old conversation', 1500, 'Kept somewhere safe and quiet.')],
  elevator: [act('lift', 'Ride the very long lift', 2000, 'The music was excellent.', { cost: 200 })],
  beacon: [act('thanks', 'Stand in the light', 5000, 'One small light that says thank you.', { fx: 'fireworks' })],
};
const HOME = (def) => [act('knock', 'Knock on the door', Math.min(800, Math.round(60 + def.pop * 4)), 'Someone waves from the window and hands you a little something.')];
export const offersFor = (def) => (def.road || def.path ? [] : OFFERS[def.id] || (def.cat === 'homes' ? HOME(def) : [act('look', 'Have a look around', 100, 'Nice place.')]));
export const missingOffers = () => CATALOG.filter((d) => !d.road && !d.path && !d.ground && !OFFERS[d.id] && d.cat !== 'homes').map((d) => d.id);

export function makeInteract({ walker, sfx, getSave, getEarned, balance, changed, toast, fmt, esc, fx }) {
  const $ = (s) => document.querySelector(s);
  let current = null, openedAt = 0;
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  function street() { const s = getSave(); if (!s.street || s.street.day !== today()) s.street = { day: today(), got: 0, used: {} }; return s.street; }
  const usedKey = (it, o) => `${getSave().activeIsland || 0}:${it.i},${it.j}:${o.id}`;
  const pocket = () => { const s = getSave(); return s.pocket || (s.pocket = {}); };
  const limit = () => dailyLimit(getEarned()), left = () => Math.max(0, limit() - street().got);

  function reward(n, item) {
    const got = Math.min(n || 0, left()), s = getSave();
    if (got > 0) { s.bonus = (s.bonus || 0) + got; street().got += got; }
    if (item?.speed || item?.jump) walker.boost(item.speed || 0, item.jump || 0);
    return got;
  }
  const line = (got, wanted) => (got ? `<b>+${fmt(got)} tokens</b>` : wanted ? 'The street is out of rewards for today' : '');

  function renderPocket() {
    const box = $('#pocket'), rows = Object.entries(pocket()).filter(([, n]) => n > 0);
    box.hidden = !rows.length;
    box.innerHTML = rows.slice(0, 9).map(([id, n], k) => `<button data-use="${id}" title="${ITEMS[id].note || `+${fmt(ITEMS[id].tokens)} tokens`}"><kbd>${k + 1}</kbd>${esc(ITEMS[id].name)}${n > 1 ? ` <em>×${n}</em>` : ''}</button>`).join('');
  }
  function use(id) {
    const p = pocket(), item = ITEMS[id]; if (!item || !p[id]) return;
    p[id]--; if (!p[id]) delete p[id];
    const got = reward(item.tokens, item), extra = item.note ? ` · ${item.note}` : '';
    item.verb === 'drink' ? sfx.drink() : sfx.eat(); walker.gesture();
    if (got) setTimeout(() => sfx.token(1), 260);
    toast(`${esc(item.name)}. ${line(got, item.tokens)}${extra}`, 3600);
    changed(got > 0); renderPocket(); if (current) render();
  }
  function render() {
    const { it, def } = current, st = street(), bal = balance();
    const rows = offersFor(def).map((o) => {
      const item = o.item ? ITEMS[o.item] : null, cost = item ? item.cost : o.cost || 0, done = !!st.used[usedKey(it, o)], tokens = item ? item.tokens : o.tokens, poor = cost > bal;
      const sub = item ? (item.note ? `${item.note} · ` : '') + `+${fmt(tokens)} when you ${item.verb} it` : `+${fmt(tokens)} tokens${o.speed ? ' · run faster' : ''}${o.jump ? ' · jump higher' : ''}`;
      return `<div class="offer${done ? ' done' : ''}"><span><b>${esc(item ? item.name : o.label)}</b><small>${sub}</small></span><button class="btn${cost ? '' : ' ghost'}" data-offer="${o.id}"${done || poor ? ' disabled' : ''}>${done ? 'Done today' : item ? (cost ? `Buy · ${fmt(cost)}` : 'Take one') : cost ? `Pay ${fmt(cost)}` : 'Do it'}</button></div>`;
    }).join('');
    $('#interact').innerHTML = `<h3>${esc(it.nick || def.name)}</h3><p>${esc(def.desc || '')}</p><div class="offers">${rows}</div><div class="streetBar"><span>Street rewards today</span><b>${fmt(st.got)} / ${fmt(limit())}</b><i><u style="width:${Math.min(100, (st.got / limit()) * 100).toFixed(1)}%"></u></i></div><button class="btn ghost" id="intClose">Back to walking <kbd>E</kbd></button>`;
    $('#intClose').onclick = close;
  }
  function doOffer(id) {
    if (!current) return;
    const { it, def } = current, o = offersFor(def).find((x) => x.id === id); if (!o) return;
    const st = street(), key = usedKey(it, o); if (st.used[key]) { sfx.deny(); return; }
    const item = o.item ? ITEMS[o.item] : null, cost = item ? item.cost : o.cost || 0, s = getSave();
    if (cost > balance()) { sfx.deny(); toast(`You need <b>${fmt(cost - balance())}</b> more tokens.`); return; }
    s.spent = (s.spent || 0) + cost; st.used[key] = 1;
    if (item) { const p = pocket(); p[o.item] = (p[o.item] || 0) + 1; sfx.coin(); toast(`<b>${esc(item.name)}</b> is in your pocket. Press its number to ${item.verb} it.`, 3600); }
    else {
      const got = reward(o.tokens, o); sfx.coin(); if (got) setTimeout(() => sfx.token(1), 180);
      toast(`${esc(o.text)} ${line(got, o.tokens)}`, 4600);
      if (o.fx) fx(o.fx);
    }
    changed(true); renderPocket(); render();
  }
  function open(it) {
    const def = BY_ID[it.id]; if (!offersFor(def).length) return;
    current = { it, def }; openedAt = performance.now(); walker.setMenu(true); $('#interact').hidden = false; sfx.click(); render();
  }
  function close() { if (!current) return; current = null; $('#interact').hidden = true; sfx.click(); walker.setMenu(false); }
  $('#interact').addEventListener('click', (e) => { const b = e.target.closest('[data-offer]'); if (b && !b.disabled) doOffer(b.dataset.offer); });
  $('#pocket').addEventListener('click', (e) => { const b = e.target.closest('[data-use]'); if (b) use(b.dataset.use); });
  addEventListener('keydown', (e) => {
    if (!walker.on || e.target.matches?.('input[type=text]') || !$('#modal').hidden) return;
    if (current && (e.code === 'Escape' || (e.code === 'KeyE' && !e.repeat && performance.now() - openedAt > 120))) { e.preventDefault(); close(); return; }
    if (/^Digit[1-9]$/.test(e.code) && !e.repeat) { const rows = Object.entries(pocket()).filter(([, n]) => n > 0), row = rows[Number(e.code.slice(5)) - 1]; if (row) use(row[0]); }
  });
  return { open, close, renderPocket, doOffer, use, get current() { return current; }, street };
}
