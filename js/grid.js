/* Warmpaper Interactive Grid — inspired by DeepSeek Harness.
   A canvas-based grid of points and connecting lines that react to mouse
   proximity with a light physics simulation. Fully theme-aware (light/dark)
   and performant via requestAnimationFrame throttling + IntersectionObserver. */
(function () {
  'use strict';

  var canvas = document.getElementById('grid-canvas');
  if (!canvas) return;

  // Skip on mobile / non-hover devices for performance
  if (window.matchMedia('(hover: none), (pointer: coarse)').matches) return;

  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  /* --- Theme color reading (CSS custom properties) --- */
  var root = document.documentElement;

  function themeColors() {
    var computed = getComputedStyle(root);
    // accent color drives the grid (orange in warm theme)
    var accent = computed.getPropertyValue('--color-accent').trim();
    // fallback if CSS var not yet set
    if (!accent) accent = '#DA7756';
    var r = parseInt(accent.slice(1, 3), 16);
    var g = parseInt(accent.slice(3, 5), 16);
    var b = parseInt(accent.slice(5, 7), 16);
    // adapt opacity to theme
    var isDark = root.getAttribute('data-theme') === 'dark';
    return {
      lineColor: 'rgba(' + r + ', ' + g + ', ' + b + ',',
      dotColor:  'rgba(' + r + ', ' + g + ', ' + b + ',',
      lineOpacity: isDark ? 0.1 : 0.14,
      dotOpacity: isDark ? 0.25 : 0.35
    };
  }

  var config = themeColors();

  /* --- Grid state --- */
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var spacing = 90;          // distance between grid points (DeepSeek default)
  var points = [];           // array of {restX, restY, x, y, vx, vy}
  var cols, rows;            // grid dimensions
  var canvasW, canvasH;      // logical (CSS) canvas size

  var mouse = { x: NaN, y: NaN };   // mouse position relative to canvas
  var rAF = null;            // requestAnimationFrame id
  var idleTimer = null;      // delay grid rebuild on resize
  var visible = true;         // IntersectionObserver may set to false (background tab)
  var lastFrame = 0;
  var fpsCap = 1000 / 30;    // 30 FPS cap (DeepSeek default)

  /* --- Initialize / rebuild grid points --- */
  function initPoints() {
    cols = Math.ceil(canvasW / spacing) + 1;
    rows = Math.ceil(canvasH / spacing) + 1;
    // offset so grid is centered in the canvas
    var offsetX = (canvasW - (cols - 1) * spacing) / 2;
    var offsetY = (canvasH - (rows - 1) * spacing) / 2;
    points = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var px = offsetX + spacing * c;
        var py = offsetY + spacing * r;
        points.push({
          restX: px, restY: py,
          x: px,    y: py,
          vx: 0,    vy: 0
        });
      }
    }
  }

  /* --- Canvas resize --- */
  function resize() {
    canvasW = canvas.clientWidth;
    canvasH = canvas.clientHeight;
    canvas.width  = canvasW * dpr;
    canvas.height = canvasH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(initPoints, 150);
  }

  /* --- Mouse interaction --- */
  function onMouseMove(e) {
    if (!visible) return; // skip when canvas is off-screen
    var rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    if (!rAF) rAF = requestAnimationFrame(loop);
  }

  /* --- Main animation loop --- */
  function loop(timestamp) {
    if (timestamp - lastFrame < fpsCap) {
      rAF = requestAnimationFrame(loop);
      return;
    }
    lastFrame = timestamp - (timestamp - lastFrame) % fpsCap;

    var hasMouse = !isNaN(mouse.x) && !isNaN(mouse.y);
    var maxVel = 0;

    ctx.clearRect(0, 0, canvasW, canvasH);

    // --- Physics: apply forces to each point ---
    for (var i = 0; i < points.length; i++) {
      var p = points[i];

      // 1. Mouse proximity attraction/repulsion (140px radius)
      if (hasMouse) {
        var dx = p.x - mouse.x;
        var dy = p.y - mouse.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 140 && dist > 0.1) {
          var strength = (1 - dist / 140) * 30;
          var nx = dx / dist;
          var ny = dy / dist;
          p.vx += nx * strength * 0.1;
          p.vy += ny * strength * 0.1;
        }
      }

      // 2. Spring back to rest position
      var rx = p.restX - p.x;
      var ry = p.restY - p.y;
      p.vx += 0.05 * rx;
      p.vy += 0.05 * ry;

      // 3. Damping
      p.vx *= 0.85;
      p.vy *= 0.85;
      p.x += p.vx;
      p.y += p.vy;

      var vel = Math.abs(p.vx) + Math.abs(p.vy);
      if (vel > maxVel) maxVel = vel;
    }

    // --- Draw lines between adjacent points ---
    ctx.strokeStyle = config.lineColor + config.lineOpacity + ')';
    ctx.lineWidth = 0.5;
    ctx.lineCap = 'round';

    var gi = 0; // flat grid index helper

    // horizontal lines
    for (var rr = 0; rr < rows; rr++) {
      for (var cc = 0; cc < cols - 1; cc++) {
        var a = points[rr * cols + cc];
        var b = points[rr * cols + cc + 1];
        drawLine(a, b);
      }
    }
    // vertical lines
    for (var cc2 = 0; cc2 < cols; cc2++) {
      for (var rr2 = 0; rr2 < rows - 1; rr2++) {
        var a2 = points[rr2 * cols + cc2];
        var b2 = points[(rr2 + 1) * cols + cc2];
        drawLine(a2, b2);
      }
    }

    function drawLine(a, b) {
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 20) return; // skip when points are too close (overlapping from physics)
      var nx = dx / dist;
      var ny = dy / dist;
      ctx.beginPath();
      ctx.moveTo(a.x + 10 * nx, a.y + 10 * ny);
      ctx.lineTo(b.x - 10 * nx, b.y - 10 * ny);
      ctx.stroke();
    }

    // --- Draw dots at each point ---
    ctx.fillStyle = config.dotColor + config.dotOpacity + ')';
    for (var i2 = 0; i2 < points.length; i2++) {
      var pt = points[i2];
      var size = 1.8;
      var opacity = config.dotOpacity;
      if (hasMouse) {
        var mx = pt.x - mouse.x;
        var my = pt.y - mouse.y;
        var mdist = Math.sqrt(mx * mx + my * my);
        var glow = Math.max(0, 1 - mdist / 140);
        size = 1.8 + 2 * glow;
        opacity = config.dotOpacity + 0.4 * glow;
      }
      ctx.globalAlpha = opacity;
      var s = 2 * size;
      ctx.fillRect(pt.x - size, pt.y - size, s, s);
    }
    ctx.globalAlpha = 1;

    // Continue or stop animation
    if (maxVel < 0.01) {
      rAF = null;
    } else if (visible) {
      rAF = requestAnimationFrame(loop);
    }
  }

  /* --- IntersectionObserver: only animate when visible --- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      visible = entry.isIntersecting;
      if (!visible && rAF) {
        cancelAnimationFrame(rAF);
        rAF = null;
      }
    });
  }, { threshold: 0 });

  /* --- Theme change observer --- */
  var themeObserver = new MutationObserver(function () {
    config = themeColors();
  });
  themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  /* --- Init --- */
  window.addEventListener('resize', resize);
  // Listen on document (not canvas) because .grid-bg has pointer-events: none
  document.addEventListener('mousemove', onMouseMove);
  io.observe(canvas);
  resize();

  // Start animation immediately so the static grid is visible
  rAF = requestAnimationFrame(loop);
})();
