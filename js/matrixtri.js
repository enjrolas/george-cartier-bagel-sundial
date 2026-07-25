// A reusable 2D "matrix bagel" pointer triangle: a translucent glowing-green
// wedge with glowing edges and a falling ASCII-bagel rain, drawn to a canvas
// element you can position + rotate in the DOM. Same look as the 3D triangle on
// the / map, for the AR overlays. Uses `mix-blend-mode: screen` so the dark
// parts drop out over the camera feed and only the green glows.

const GLYPHS = ['◯', '⊙', '0', 'O', 'o', '()', '◎', 'Ø', 'Q', '🥯'];

export function createMatrixTriangle(W = 120, H = 210) {
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  cnv.style.transformOrigin = 'bottom center';
  cnv.style.mixBlendMode = 'screen';
  cnv.style.pointerEvents = 'none';
  const ctx = cnv.getContext('2d');

  const ax = W / 2, ay = H, tw = W * 0.42;         // apex at bottom-centre, base across the top
  const path = () => { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - tw, 0); ctx.lineTo(ax + tw, 0); ctx.closePath(); };

  const CELL = 16, COLS = Math.ceil(W / CELL);
  const drops = Array.from({ length: COLS }, () => (Math.random() * H / CELL) | 0);

  function frame() {
    ctx.save();
    path(); ctx.clip();
    ctx.fillStyle = 'rgba(0,12,5,0.26)'; ctx.fillRect(0, 0, W, H);     // fade → trails
    ctx.fillStyle = 'rgba(20,120,60,0.10)'; ctx.fillRect(0, 0, W, H);  // faint green wash
    ctx.font = `${CELL}px monospace`; ctx.textBaseline = 'top';
    for (let i = 0; i < COLS; i++) {
      const x = i * CELL, y = drops[i] * CELL;
      ctx.fillStyle = '#2bff86'; ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], x, y - CELL);
      ctx.fillStyle = '#e9fff0'; ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], x, y);
      drops[i]++;
      if (y > H && Math.random() > 0.95) drops[i] = 0;
    }
    ctx.restore();
    ctx.save();
    ctx.shadowColor = 'rgba(120,255,180,0.9)'; ctx.shadowBlur = 8;
    ctx.strokeStyle = '#9dffc4'; ctx.lineWidth = 2; path(); ctx.stroke();
    ctx.restore();
    cnv._raf = requestAnimationFrame(frame);
  }
  frame();
  return cnv;
}
