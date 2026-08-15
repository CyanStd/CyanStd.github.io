/* Warmpaper Interactive Grid — inspired by DeepSeek Harness.
   Optimized canvas grid with physics simulation, mouse interaction,
   and batched rendering for smooth 60 FPS animation. */
(function () {
  'use strict';

  var canvas = document.getElementById('grid-canvas');
  if (!canvas) return;

  // Skip on mobile / non-hover devices
  if (window.matchMedia('(hover: none), (pointer: coarse)').matches) return;

  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  /* --- Theme colors (CSS variables, theme-aware) --- */
  var root = document.documentElement;

  function themeColors() {
    var computed = getComputedStyle(root);
    var accent = computed.getPropertyValue('--color-accent').trim() || '#DA7756';
    var r = parseInt(accent.slice(1, 3), 16);
    var g = parseInt(accent.slice(3, 5), 16);
    var b = parseInt(accent.slice(5, 7), 16);
    var isDark = root.getAttribute('data-theme') === 'dark';
    return {
      r: r, g: g, b: b,
      lineOpacity: isDark ? 0.1 : 0.14,
      dotOpacityBase: isDark ? 0.25 : 0.3
    };
  }

  var config = themeColors();

  /* --- Grid configuration --- */
  var SPACING = 90;           // grid spacing (DeepSeek default)
  var MOUSE_RADIUS = 140;     // mouse influence radius
  var MOUSE_RADIUS_SQ = MOUSE_RADIUS * MOUSE_RADIUS;
  var MAX_FPS = 60;
  var MIN_FRAME = 1000 / MAX_FPS;

  /* --- Grid state --- */
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var points = [];            // flat array of [x, y, restX, restY, vx, vy]
  var edges = [];             // adjacency: pairs of [a, b] indices
  var cols, rows;             // grid dimensions
  var canvasW, canvasH;       // logical canvas size

  var mouseX = NaN, mouseY = NaN;
  var rAF = 0;
  var lastFrame = 0;
  var idleTimer = null;
  var visible = true;

  /* --- Initialize grid points and edges (flat typed arrays for speed) --- */
  function initPoints() {
    cols = Math.ceil(canvasW / SPACING) + 1;
    rows = Math.ceil(canvasH / SPACING) + 1;
    var offsetX = (canvasW - (cols - 1) * SPACING) / 2;
    var offsetY = (canvasH - (rows - 1) * SPACING) / 2;

    // Flat array: every 6 floats = one point
    // [x, y, restX, restY, vx, vy]
    points = new Float32Array(rows * cols * 6);
    edges = [];

    var i = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var px = offsetX + SPACING * c;
        var py = offsetY + SPACING * r;
        points[i]     = px;  // x
        points[i + 1] = py;  // y
        points[i + 2] = px;  // restX
        points[i + 3] = py;  // restY
        points[i + 4] = 0;   // vx
        points[i + 5] = 0;   // vy
        i += 6;
      }
    }

    // Pre-compute edges (horizontal + vertical connections)
    edges = new Int32Array((cols - 1) * rows * 2 + cols * (rows - 1) * 2);
    var ei = 0;
    for (var rr = 0; rr < rows; rr++) {
      for (var cc = 0; cc < cols - 1; cc++) {
        edges[ei++] = rr * cols + cc;     // a
        edges[ei++] = rr * cols + cc + 1; // b
      }
    }
    for (var cc2 = 0; cc2 < cols; cc2++) {
      for (var rr2 = 0; rr2 < rows - 1; rr2++) {
        edges[ei++] = rr2 * cols + cc2;           // a
        edges[ei++] = (rr2 + 1) * cols + cc2;     // b
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
    if (!visible) return;
    var rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
    if (!rAF) rAF = requestAnimationFrame(loop);
  }

  /* --- Main animation loop (optimized) --- */
  function loop(timestamp) {
    // Adaptive FPS: skip if too fast
    var elapsed = timestamp - lastFrame;
    if (elapsed < MIN_FRAME) {
      rAF = requestAnimationFrame(loop);
      return;
    }
    lastFrame = timestamp - (timestamp - lastFrame) % MIN_FRAME;

    var hasMouse = !isNaN(mouseX) && !isNaN(mouseY);
    var maxVel = 0;
    var numPoints = points.length;
    var numEdges = edges.length;

    ctx.clearRect(0, 0, canvasW, canvasH);

    // --- Physics: vectorized update using flat array ---
    // 1. Mouse proximity force
    if (hasMouse) {
      for (var i = 0; i < numPoints; i += 6) {
        var dx = points[i] - mouseX;
        var dy = points[i + 1] - mouseY;
        var distSq = dx * dx + dy * dy;
        if (distSq < MOUSE_RADIUS_SQ && distSq > 0.01) {
          var dist = Math.sqrt(distSq);
          var strength = (1 - dist / MOUSE_RADIUS) * 30;
          var nx = dx / dist;
          var ny = dy / dist;
          points[i + 4] += nx * strength * 0.1;  // vx
          points[i + 5] += ny * strength * 0.1;  // vy
        }
      }
    }

    // 2. Spring + damping (single pass)
    for (var j = 0; j < numPoints; j += 6) {
      points[j + 4] += 0.05 * (points[j + 2] - points[j]);   // vx += k * (restX - x)
      points[j + 5] += 0.05 * (points[j + 3] - points[j + 1]); // vy += k * (restY - y)
      points[j + 4] *= 0.85;  // damping vx
      points[j + 5] *= 0.85;  // damping vy
      points[j]     += points[j + 4];  // x
      points[j + 1] += points[j + 5];  // y

      var vel = Math.abs(points[j + 4]) + Math.abs(points[j + 5]);
      if (vel > maxVel) maxVel = vel;
    }

    var cfg = config;

    // --- Batch draw lines (single stroke call) ---
    ctx.strokeStyle = 'rgba(' + cfg.r + ',' + cfg.g + ',' + cfg.b + ',' + cfg.lineOpacity + ')';
    ctx.lineWidth = 0.5;
    ctx.lineCap = 'round';

    ctx.beginPath();
    for (var e = 0; e < numEdges; e += 2) {
      var ai = edges[e] * 6;
      var bi = edges[e + 1] * 6;
      var ldx = points[bi] - points[ai];
      var ldy = points[bi + 1] - points[ai + 1];
      var ldist = Math.sqrt(ldx * ldx + ldy * ldy);
      if (ldist < 20) continue;
      var lnx = ldx / ldist;
      var lny = ldy / ldist;
      ctx.moveTo(points[ai] + 10 * lnx, points[ai + 1] + 10 * lny);
      ctx.lineTo(points[bi] - 10 * lnx, points[bi + 1] - 10 * lny);
    }
    ctx.stroke();

    // --- Batch draw dots (single path, single fill) ---
    // Per-point alpha is baked into the fillStyle rgba string so a single
    // fill() call renders all dots correctly with individual opacities.
    ctx.beginPath();
    for (var d = 0; d < numPoints; d += 6) {
      var size = 1.8;
      var alpha = cfg.dotOpacityBase;
      if (hasMouse) {
        var mx = points[d] - mouseX;
        var my = points[d + 1] - mouseY;
        var mdSq = mx * mx + my * my;
        if (mdSq < MOUSE_RADIUS_SQ) {
          var md = Math.sqrt(mdSq);
          var glow = 1 - md / MOUSE_RADIUS;
          size = 1.8 + 2 * glow;
          alpha = cfg.dotOpacityBase + 0.4 * glow;
        }
      }
      ctx.fillStyle = 'rgba(' + cfg.r + ',' + cfg.g + ',' + cfg.b + ',' + alpha + ')';
      var s2 = size;
      ctx.rect(points[d] - s2, points[d + 1] - s2, 2 * s2, 2 * s2);
    }
    ctx.fill();

    // Continue animation or idle out
    if (maxVel < 0.01) {
      rAF = null;
    } else if (visible) {
      rAF = requestAnimationFrame(loop);
    }
  }

  /* --- IntersectionObserver: pause when off-screen --- */
  var io = new IntersectionObserver(function (entries) {
    var entry = entries[0];
    visible = entry.isIntersecting;
    if (!visible && rAF) {
      cancelAnimationFrame(rAF);
      rAF = null;
    }
  }, { threshold: 0 });

  /* --- Theme change observer --- */
  var themeObserver = new MutationObserver(function () {
    config = themeColors();
  });
  themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  /* --- Init --- */
  window.addEventListener('resize', resize);
  document.addEventListener('mousemove', onMouseMove);
  io.observe(canvas);
  resize();
  rAF = requestAnimationFrame(loop);
})();
