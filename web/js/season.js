// Seasons follow the real date: spring blossom, green summer, golden autumn, snowy December.
// Add ?season=winter (or spring, summer, autumn) to the address to preview one.
const q = new URLSearchParams(location.search).get('season');
const m = new Date().getMonth();
export const SEASON = ['spring', 'summer', 'autumn', 'winter'].includes(q) ? q
  : m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter';

// Tree crowns, grass and ground tints per season.
const P = {
  spring: { crowns: ['#86b06a', '#9cc47a', '#f2b8c6', '#7aa65e', '#f6cdd6'], pine: ['#5f8a55', '#6a9660'], grass: '#9fc27f', wild: '#8fb873', snow: 0 },
  summer: { crowns: ['#7fa36a', '#6f9a5c', '#8db36f', '#5f8a55'], pine: ['#5a8250', '#4f7748'], grass: '#a3c283', wild: '#8eb271', snow: 0 },
  autumn: { crowns: ['#e0a04f', '#d4793f', '#c9a14a', '#b8603a', '#9fae5e', '#e8b85c'], pine: ['#5c7f52', '#4f7449'], grass: '#b4bf84', wild: '#a3ae72', snow: 0 },
  winter: { crowns: ['#eef2f4', '#dde6ea', '#c9d6da'], pine: ['#4f7449', '#5c7f52'], grass: '#eef1f2', wild: '#e4e9eb', snow: 1 },
};
export const PAL = P[SEASON];
export const crown = (r) => PAL.crowns[Math.floor(r * PAL.crowns.length)];
export const pine = (r) => PAL.pine[Math.floor(r * PAL.pine.length)];
