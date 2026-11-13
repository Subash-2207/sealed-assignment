(() => {
  const key = 'sealed-assignment-theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch {
    // The theme still works for this visit when storage is unavailable.
  }

  function applyTheme() {
    const theme = preference ?? (system.matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#171717' : '#f4f0fa';
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(theme === 'dark'));
      document.getElementById('theme-label').textContent = theme === 'dark' ? 'Dark' : 'Light';
    }
  }

  applyTheme();
  system.addEventListener('change', applyTheme);
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    document.getElementById('theme-toggle').addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, preference); } catch {}
      applyTheme();
    });

    const pointerToggle = document.getElementById('pointer-toggle');
    const glow = document.getElementById('cursor-glow');
    const motionAllowed = window.matchMedia('(prefers-reduced-motion: no-preference)');
    const pointerKey = 'sealed-assignment-cursor-effects';
    let enabled = true;
    let frame = 0;
    try { enabled = localStorage.getItem(pointerKey) !== 'off'; } catch {}

    function hideGlow() {
      cancelAnimationFrame(frame);
      glow.hidden = true;
    }

    function updatePointerToggle() {
      pointerToggle.hidden = false;
      pointerToggle.disabled = !motionAllowed.matches;
      pointerToggle.title = motionAllowed.matches ? 'Toggle the pointer glow' : 'Cursor glow is off while reduced motion is enabled';
      pointerToggle.setAttribute('aria-pressed', String(enabled && motionAllowed.matches));
      if (!enabled || !motionAllowed.matches) hideGlow();
    }

    updatePointerToggle();
    motionAllowed.addEventListener('change', updatePointerToggle);
    pointerToggle.addEventListener('click', () => {
      enabled = !enabled;
      try { localStorage.setItem(pointerKey, enabled ? 'on' : 'off'); } catch {}
      updatePointerToggle();
    });
    document.addEventListener('pointermove', event => {
      if (!enabled || !motionAllowed.matches || event.pointerType !== 'mouse') {
        hideGlow();
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        glow.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
        glow.classList.toggle('over-control', Boolean(event.target.closest('a, button, summary')));
        glow.hidden = false;
      });
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', hideGlow);
    window.addEventListener('blur', hideGlow);
  });
})();
