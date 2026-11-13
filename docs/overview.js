import { setupGlassCard } from './glass-card.js';

export function setupOverview(winner, providers, canLeave) {
  const home = document.getElementById('home');
  const hero = document.getElementById('hero');
  const menu = document.getElementById('menu');
  const openButton = document.getElementById('menu-open');
  const closeButton = document.getElementById('menu-close');
  const dialog = menu.querySelector('[role="dialog"]');
  const signOut = document.getElementById('overview-sign-out');
  const glass = setupGlassCard(home);

  document.getElementById('overview-total').textContent = new Intl.NumberFormat('en').format(winner.total);
  const assignments = winner.order.map((provider, job) => {
    const row = document.createElement('div');
    const label = document.createElement('dt');
    const value = document.createElement('dd');
    label.textContent = `Job ${String(job + 1).padStart(2, '0')}`;
    value.textContent = `Provider ${providers[provider]}`;
    row.append(label, value);
    return row;
  });
  document.getElementById('overview-assignments').replaceChildren(...assignments);

  function setMenu(open, restoreFocus = true) {
    menu.classList.toggle('is-open', open);
    openButton.setAttribute('aria-expanded', String(open));
    menu.inert = !open;
    hero.inert = open;
    if (open) {
      menu.setAttribute('aria-hidden', 'false');
      closeButton.focus({ preventScroll: true });
    } else {
      if (restoreFocus) openButton.focus({ preventScroll: true });
      menu.setAttribute('aria-hidden', 'true');
    }
  }

  openButton.addEventListener('click', () => setMenu(true));
  closeButton.addEventListener('click', () => setMenu(false));
  document.getElementById('menu-backdrop').addEventListener('click', () => setMenu(false));
  for (const link of menu.querySelectorAll('a')) link.addEventListener('click', () => setMenu(false));
  signOut.hidden = !canLeave;
  signOut.textContent = document.getElementById('leave-workspace').textContent;
  signOut.addEventListener('click', () => document.getElementById('leave-workspace').click());

  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') return setMenu(false);
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not([hidden]), a[href]')];
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    if (document.activeElement === edge) {
      event.preventDefault();
      (event.shiftKey ? controls.at(-1) : controls[0]).focus();
    }
  });

  return {
    setActive(active) {
      if (!active && menu.classList.contains('is-open')) setMenu(false, false);
      glass.setActive(active);
    },
  };
}
