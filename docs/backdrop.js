const screen = document.querySelector('.robot-screen');
const video = screen.querySelector('video');
const gaze = screen.querySelector('.robot-gaze');

function showRobot() {
  screen.dataset.ready = '';
}

video.addEventListener('loadeddata', showRobot, { once: true });
if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) showRobot();

document.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch') return;
  const bounds = screen.getBoundingClientRect();
  const faceX = bounds.left + bounds.width * 0.4948;
  const faceY = bounds.top + bounds.height * 0.3185;
  const x = Math.tanh((event.clientX - faceX) / (bounds.width * 0.18));
  const y = Math.tanh((event.clientY - faceY) / (bounds.height * 0.4));
  gaze.style.setProperty('--gaze-x', `${x * 2.5}cqw`);
  gaze.style.setProperty('--gaze-y', `${y * 1.7}cqw`);
}, { passive: true });

function resetGaze() {
  gaze.style.removeProperty('--gaze-x');
  gaze.style.removeProperty('--gaze-y');
}

document.documentElement.addEventListener('pointerleave', resetGaze);
window.addEventListener('blur', resetGaze);
