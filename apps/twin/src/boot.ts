// The load screen. index.html draws it before any script runs. This module tells what is loading,
// moves it into the 3D stage once the page is up (the tabs and the panel can be used while the
// twin loads), and fades it out when the twin's first frame is ready.

const el = () => document.getElementById('boot');

export const boot = {
  status: (text: string) => {
    const s = document.getElementById('boot-status');
    if (s) s.textContent = text;
  },

  /** The page is up: from now on the load screen covers only the stage. The pads glide to their
   *  new place instead of jumping there. */
  attach: (stage: HTMLElement) => {
    const b = el(), pads = b?.querySelector<HTMLElement>('.boot-pads');
    if (!b || !pads || b.parentElement === stage) return;
    const from = pads.getBoundingClientRect();
    stage.appendChild(b);
    b.classList.add('in-stage');
    const to = pads.getBoundingClientRect();
    const dx = from.left - to.left, dy = from.top - to.top;
    if ((dx || dy) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      pads.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    }
  },

  /** The twin's first frame is on screen. */
  done: () => {
    const b = el();
    if (!b || b.classList.contains('gone')) return;
    b.classList.add('gone');
    setTimeout(() => b.remove(), 600);
  },

  /** The twin could not start: say so, and keep the rest of the page usable. */
  fail: (text: string) => {
    el()?.classList.add('failed');
    boot.status(text);
  },
};
