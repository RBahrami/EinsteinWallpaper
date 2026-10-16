/*
 * infotips.js — hover tooltips for the small (i) icons in the sidebar.
 *
 * Each .infotip element carries its rich text in a hidden .tipcontent
 * child. One shared .tipbubble is appended to <body> and positioned with
 * position:fixed next to the active icon, so the text can never be clipped
 * by the sidebar's scroll containers (overflow-y: auto clips absolutely
 * positioned children, but not fixed-position elements outside of them).
 *
 * Behavior:
 *   - show on mouseenter / keyboard focus
 *   - hide on mouseleave / blur / Escape (with a tiny grace period so a
 *     brief pointer wiggle does not flicker the bubble)
 *   - Enter/Space or a click toggles (for touch users); clicking the icon
 *     never folds the surrounding <details> section
 *   - the bubble follows the icon on scroll/resize while visible
 */
(() => {
  'use strict';

  const bubble = document.createElement('div');
  bubble.className = 'tipbubble';
  bubble.setAttribute('role', 'tooltip');
  bubble.hidden = true;
  document.body.appendChild(bubble);

  let active = null;
  let hideTimer = 0;
  const VIEW_MARGIN = 8;   // keep the bubble this far inside the viewport
  const GAP = 7;           // gap between the icon and the bubble

  function place() {
    if (!active || bubble.hidden) return;
    const r = active.getBoundingClientRect();
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    // Prefer below the icon; flip above when there is no room.
    let top = r.bottom + GAP;
    if (top + bh > window.innerHeight - VIEW_MARGIN) {
      top = Math.max(VIEW_MARGIN, r.top - bh - GAP);
    }
    // Icons sit at the sidebar's right edge, so the open stage area lies to
    // their right: prefer extending the bubble rightward, then fall back to
    // the icon's left side on narrow viewports, then clamp into the viewport.
    let left = r.right + GAP;
    if (left + bw > window.innerWidth - VIEW_MARGIN) {
      left = r.left - bw - GAP;
    }
    left = Math.min(Math.max(left, VIEW_MARGIN),
                    window.innerWidth - VIEW_MARGIN - bw);
    bubble.style.top = Math.round(top) + 'px';
    bubble.style.left = Math.round(left) + 'px';
  }

  function show(tip) {
    const content = tip.querySelector('.tipcontent');
    if (!content || !content.innerHTML.trim()) return;
    clearTimeout(hideTimer);
    if (active && active !== tip) active.classList.remove('open');
    active = tip;
    bubble.innerHTML = content.innerHTML;
    bubble.hidden = false;
    tip.classList.add('open');
    tip.setAttribute('aria-expanded', 'true');
    place();
  }

  function hide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (active) {
        active.classList.remove('open');
        active.setAttribute('aria-expanded', 'false');
      }
      active = null;
      bubble.hidden = true;
    }, 90);
  }

  /* hover */
  document.addEventListener('mouseover', (e) => {
    const tip = e.target.closest && e.target.closest('.infotip');
    if (tip) show(tip);
  });
  document.addEventListener('mouseout', (e) => {
    const tip = e.target.closest && e.target.closest('.infotip');
    if (tip && !(e.relatedTarget && tip.contains(e.relatedTarget))) hide();
  });

  /* keyboard: focus shows, blur hides, Enter/Space toggles, Escape dismisses */
  document.addEventListener('focusin', (e) => {
    const tip = e.target.closest && e.target.closest('.infotip');
    if (tip) show(tip);
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.closest && e.target.closest('.infotip')) hide();
  });
  document.addEventListener('keydown', (e) => {
    const tip = e.target.closest && e.target.closest('.infotip');
    if (!tip) {
      if (e.key === 'Escape') hide();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // don't let Space scroll / Enter fold the details
      if (bubble.hidden || active !== tip) show(tip); else hide();
    } else if (e.key === 'Escape') {
      hide();
    }
  });

  /* click / touch: toggle; must NOT fold the surrounding <details> section */
  document.addEventListener('click', (e) => {
    const tip = e.target.closest && e.target.closest('.infotip');
    if (!tip) return;
    e.preventDefault();
    e.stopPropagation();
    if (bubble.hidden || active !== tip) show(tip); else hide();
  }, true);

  /* keep the bubble anchored while visible */
  window.addEventListener('scroll', () => place(), true);
  window.addEventListener('resize', () => place());
})();
