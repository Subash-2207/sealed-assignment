export function setupGlassCard(home) {
  const video = home.querySelector('#bg-video');
  const sample = home.querySelector('.card__sample');
  const canvas = home.querySelector('#dup-image');
  const ctx = canvas.getContext('2d');
  const gaze = home.querySelector('.gaze');
  const stackedLayout = matchMedia('(max-width: 767px)');
  let pointer;
  let lastFrame = '';
  let frameId;
  let active = false;

  function drawGaze(x, y, scale) {
    const eyeWidth = .041 * scale;
    const eyeHeight = .0525 * scale;
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = .0077 * scale;
    ctx.shadowColor = '#dfc2ff';
    ctx.shadowBlur = .006 * scale;
    for (const offset of [-.0445, .0445]) {
      ctx.beginPath();
      ctx.ellipse(x + offset * scale, y, eyeWidth / 2 - ctx.lineWidth / 2, eyeHeight / 2 - ctx.lineWidth / 2, 0, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(x, y + .039 * scale, .018 * scale, .012 * scale, 0, .18 * Math.PI, .82 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    frameId = requestAnimationFrame(render);
    if (document.hidden || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    const box = sample.getBoundingClientRect();
    if (!width || !height || !box.width) return;
    canvas.style.left = `${-box.left}px`;
    canvas.style.top = `${-box.top}px`;

    const stacked = stackedLayout.matches;
    const frame = video.getBoundingClientRect();
    const cover = Math.max(frame.width / video.videoWidth, frame.height / video.videoHeight);
    const frameWidth = video.videoWidth * cover;
    const frameHeight = video.videoHeight * cover;
    const frameLeft = frame.left + (frame.width - frameWidth) / 2;
    const frameTop = frame.top + (frame.height - frameHeight) / 2;
    const faceX = frameLeft + frameWidth * .4948;
    const faceY = frameTop + frameHeight * .3185;
    const x = pointer ? Math.tanh((pointer.x - faceX) / (frameWidth * .18)) * .025 * frameWidth : 0;
    const y = pointer ? Math.tanh((pointer.y - faceY) / (frameHeight * .4)) * .017 * frameWidth : 0;
    const eyeHeight = frameWidth * .0525;
    gaze.style.cssText = `width:${frameWidth * .13}px;height:${eyeHeight}px;left:${faceX + x - frameWidth * .065}px;top:${faceY + y - eyeHeight / 2}px;--eye-border:${frameWidth * .0077}px`;
    gaze.hidden = false;
    if (!ctx) return;

    const key = [width, height, video.currentTime, x, y].join(':');
    if (lastFrame === key) return;
    // A viewport-sized canvas puts channel-separation bands at the edges of the viewport.
    // Draw at 1× to keep the three SVG displacement passes affordable on high DPI displays.
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    try {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(video, frameLeft, frameTop, frameWidth, frameHeight);
      drawGaze(faceX + x, faceY + y, frameWidth);
      const fade = ctx.createLinearGradient(frame.left, 0, frame.right, 0);
      fade.addColorStop(0, stacked ? '#0000' : '#000');
      fade.addColorStop(.19, '#000');
      fade.addColorStop(.70, '#000');
      fade.addColorStop(.82, '#0000');
      fade.addColorStop(1, '#0000');
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, width, height);
      if (stacked) {
        const edges = ctx.createLinearGradient(0, frame.top, 0, frame.bottom);
        edges.addColorStop(0, '#0000');
        edges.addColorStop(.11, '#000');
        edges.addColorStop(.89, '#000');
        edges.addColorStop(1, '#0000');
        ctx.fillStyle = edges;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.globalCompositeOperation = 'source-over';
      lastFrame = key;
    } catch {
      // The browser may still be decoding the frame. Try again next paint.
    }
  }

  document.addEventListener('pointermove', event => {
    if (active && event.pointerType !== 'touch') pointer = { x: event.clientX, y: event.clientY };
  }, { passive: true });
  const reset = () => { pointer = undefined; };
  document.documentElement.addEventListener('pointerleave', reset);
  window.addEventListener('blur', reset);
  return {
    setActive(value) {
      if (active === value) return;
      active = value;
      if (active) frameId = requestAnimationFrame(render);
      else {
        cancelAnimationFrame(frameId);
        reset();
      }
    },
  };
}
