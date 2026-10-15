/*
 * palettes.js — curated color palette library for EinsteinWallpaper.
 * Each palette: { name, bg, line (optional outline), colors: [...] }
 */
(function (root) {
  'use strict';

  const PALETTES = [
    { name: 'Midnight',     bg: '#0b1020', colors: ['#1b2a4a', '#24356b', '#31438f', '#3f5ab8', '#5871d8', '#8ea4ee'] },
    { name: 'Nord',         bg: '#2e3440', colors: ['#3b4252', '#434c5e', '#88c0d0', '#81a1c1', '#b48ead', '#a3be8c', '#ebcb8b'] },
    { name: 'Deep Space',   bg: '#05060e', colors: ['#141a33', '#232b52', '#35407a', '#4b5aa6', '#6d7fd0', '#9aa8e8', '#c3cdf5'] },
    { name: 'Aurora',       bg: '#071018', colors: ['#0f3d33', '#136f5c', '#1fa886', '#38d9a9', '#7ee8c7', '#5f7ad9', '#9d7bea'] },
    { name: 'Ocean',        bg: '#06121f', colors: ['#0d2b45', '#14496b', '#1d6f96', '#2f9fc4', '#63c7e8', '#a8e6f0'] },
    { name: 'Forest',       bg: '#0e1a12', colors: ['#1d3a26', '#2c5537', '#3f7449', '#59965e', '#7fb97f', '#b4d9a8', '#e8f3d6'] },
    { name: 'Sunset',       bg: '#1a0e14', colors: ['#4a1c3d', '#7a2750', '#b13a5e', '#e05747', '#f4854e', '#fbb361', '#ffd9a0'] },
    { name: 'Ember',        bg: '#140a06', colors: ['#3d1408', '#6b2408', '#9c3a10', '#cf5c19', '#ef8b32', '#f9bd67', '#ffe3a1'] },
    { name: 'Terracotta',   bg: '#2a1710', colors: ['#59301d', '#8a4a2b', '#b56a41', '#d18b5f', '#e0ac85', '#f0d0b0'] },
    { name: 'Coffee',       bg: '#171009', colors: ['#2e2013', '#4a341f', '#684a2d', '#8a6440', '#b08a5c', '#d6b289', '#f0dcc0'] },
    { name: 'Berry',        bg: '#1d0b16', colors: ['#43173a', '#67205a', '#8f2d7a', '#b84597', '#d972b8', '#eda6d8', '#fbd6ec'] },
    { name: 'Candy',        bg: '#241432', colors: ['#ff6fa5', '#ffb56b', '#ffe14d', '#6be3a2', '#5bc8ff', '#b07bff', '#ff8bd2'] },
    { name: 'Neon Nights',  bg: '#0a0a12', colors: ['#f9f871', '#ffe14d', '#5bffde', '#4dffb8', '#ff5b9e', '#b45bff', '#5b8cff'] },
    { name: 'Cyberpunk',    bg: '#0d0221', colors: ['#f6e409', '#00f0ff', '#ff2a6d', '#d1f7ff', '#b967ff', '#05d9e8'] },
    { name: 'Retro Arcade', bg: '#14142b', colors: ['#2b2b5e', '#e43b44', '#f77622', '#f2a25c', '#63c74d', '#3ec8c8', '#5b6ee1'] },
    { name: 'Mono',         bg: '#101010', colors: ['#1f1f1f', '#303030', '#474747', '#616161', '#7d7d7d', '#9c9c9c', '#c2c2c2', '#e8e8e8'] },
    { name: 'Ink & Paper',  bg: '#f4f1ea', colors: ['#1d2430', '#31435c', '#54718f', '#8aa2b8', '#c0ced9', '#6b5d4a'] },
    { name: 'Sakura',       bg: '#fdf0f4', colors: ['#f7c2d9', '#f29cbf', '#e97ba8', '#d65c90', '#b64b7d', '#8d3f6b', '#5e3452'] },
    { name: 'Lavender',     bg: '#f3f0fa', colors: ['#d8cff0', '#bcb0e4', '#9d8fd6', '#7f6fc4', '#6455a8', '#4c3f86', '#352c61'] },
    { name: 'Mint',         bg: '#eef7f2', colors: ['#c5e8d8', '#9dd8c0', '#74c5a6', '#4faf8b', '#358a6d', '#256a54', '#174c3c'] },
    { name: 'Sandstone',    bg: '#f5ecdc', colors: ['#d9c3a3', '#c2a37c', '#a8835b', '#8a6642', '#6d4d31', '#4f3722', '#332416'] },
    { name: 'Coral Reef',   bg: '#122530', colors: ['#1d4356', '#2c627c', '#3f8ba8', '#67b7cd', '#f2957a', '#e86f52', '#c94f38'] },
    { name: 'Citrus',       bg: '#1b2409', colors: ['#4a5a13', '#7a8a1d', '#b3c226', '#e0e94d', '#f7fa9b', '#f5b53d', '#f08a2d'] },
    { name: 'Slate & Amber',bg: '#1c2228', colors: ['#2a3440', '#3a4a5c', '#4d6378', '#e8a13d', '#f2bc6b', '#f7d29b', '#8fa3b8'] },
    { name: 'Duotone',      bg: '#10141c', colors: ['#173a5e', '#2f6f9e', '#5aa7d4', '#a8d5f2', '#e85d3d', '#f28d75'] },
    { name: 'Moss & Stone', bg: '#15181a', colors: ['#26302c', '#394743', '#4d5f5a', '#6b807a', '#98aca4', '#c4d1ca', '#8a7f72'] },
  ];

  // --- color helpers -------------------------------------------------------
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbToHex(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  }
  function shade(hex, f) { // f<1 darken toward black, f>1 lighten toward white
    const [r, g, b] = hexToRgb(hex);
    if (f <= 1) return rgbToHex(r * f, g * f, b * f);
    const t = f - 1;
    return rgbToHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
  }
  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  function autoLineColor(bg) {
    // dark line on light bg, deep-black-ish line on dark bg
    return luminance(bg) > 0.5 ? shade(bg, 0.55) : shade(bg, 0.28);
  }
  function hslRotate(hex, deg) {
    // rotate hue by deg (HSL space)
    let [r, g, b] = hexToRgb(hex).map((v) => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    const d = max - min;
    if (d) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    h = (h + deg / 360) % 1;
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    if (s === 0) { r = g = b = l; }
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
    }
    return rgbToHex(r * 255, g * 255, b * 255);
  }

  let customResolver = null; // set by custom-palettes integration in app.js
  function getPalette(ref) {
    // ref: number (legacy builtin index) | {kind:'builtin',index} | {kind:'custom',id}
    if (ref && typeof ref === 'object' && ref.kind === 'custom' && customResolver) {
      const p = customResolver(ref.id);
      if (p) return p;
    }
    const i = (ref && typeof ref === 'object') ? (ref.index || 0) : (typeof ref === 'number' ? ref : 0);
    return PALETTES[((i % PALETTES.length) + PALETTES.length) % PALETTES.length];
  }

  root.Palettes = {
    LIST: PALETTES,
    get: getPalette,
    setCustomResolver(fn) { customResolver = fn; },
    hexToRgb, rgbToHex, shade, luminance, autoLineColor, hslRotate,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Palettes;
})(typeof window !== 'undefined' ? window : globalThis);
