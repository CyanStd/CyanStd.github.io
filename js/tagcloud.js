/* Warmpaper 3D Spherical Tag Cloud.
   Tags distributed on a sphere via Fibonacci lattice, projected to 2D.
   Interactions:
     - DRAG (mousedown + move) rotates the sphere, with inertia.
     - HOVER (mouse passing through) repels nearby tags in screen space.
   Uses DOM elements for native clickability + CSS transforms for 60 FPS. */
(function () {
  'use strict';

  var cloud = document.querySelector('.tag-cloud-3d');
  if (!cloud) return;

  // Skip on mobile / non-hover devices
  if (window.matchMedia('(hover: none), (pointer: coarse)').matches) {
    cloud.classList.add('tag-cloud-fallback');
    return;
  }

  var tags = Array.prototype.slice.call(
    cloud.querySelectorAll('.tag-cloud-item')
  );
  if (!tags.length) return;

  /* --- Configuration --- */
  var SPHERE_RADIUS = 140;          // virtual 3D sphere radius (CSS px)
  var FOV = 600;                    // perspective distance
  var SPRING_K = 0.025;             // spring stiffness toward rest position
  var DAMPING = 0.86;               // velocity decay per frame
  var DRAG_SENSITIVITY = 0.005;     // radians of rotation per pixel of drag
  var DRAG_INERTIA = 0.92;          // angular velocity decay after release
  var SCATTER_RADIUS = 120;         // px, screen-space radius of influence
  var SCATTER_STRENGTH = 0.02;      // 3D repulsion force multiplier
  var MIN_ROT_X = -1.4, MAX_ROT_X = 1.4; // clamp rotX (avoid gimbal flip)
  var AUTO_ROTATE_SPEED = 0.0015;   // idle auto-rotation

  /* --- Fibonacci sphere distribution --- */
  function fibonacciSphere(n) {
    var pts = [];
    if (n === 1) return [{ x: 0, y: 0, z: 1 }];
    var golden = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.39996 rad
    for (var i = 0; i < n; i++) {
      var y = 1 - (i / (n - 1)) * 2;
      var radius = Math.sqrt(1 - y * y);
      var theta = golden * i;
      pts.push({
        x: radius * Math.cos(theta),
        y: y,
        z: radius * Math.sin(theta)
      });
    }
    return pts;
  }

  /* --- 3D → 2D perspective projection --- */
  var rotX = 0, rotY = 0;
  var rotVelX = 0, rotVelY = 0;
  var cx, cy;

  function project(x, y, z) {
    // Rotate around Y axis
    var cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    var x1 = x * cosY + z * sinY;
    var z1 = -x * sinY + z * cosY;
    // Rotate around X axis
    var cosX = Math.cos(rotX), sinX = Math.sin(rotX);
    var y1 = y * cosX - z1 * sinX;
    var z2 = y * sinX + z1 * cosX;

    // Perspective divide
    var fov = FOV / (FOV + z2 * SPHERE_RADIUS);
    var px = cx + x1 * SPHERE_RADIUS * fov;
    var py = cy + y1 * SPHERE_RADIUS * fov;
    var scale = fov * 0.8;

    return {
      x: px,
      y: py,
      scale: Math.max(0.05, scale),
      depth: z2
    };
  }

  /* --- Build tag state --- */
  var spherePoints = fibonacciSphere(tags.length);

  tags.forEach(function (tag, idx) {
    var sp = spherePoints[idx];
    tag._p = {
      ox: sp.x, oy: sp.y, oz: sp.z,
      x: sp.x, y: sp.y, z: sp.z,
      vx: 0, vy: 0, vz: 0
    };
    tag.style.visibility = 'visible';
  });

  /* --- Interaction state --- */
  var mouseX = NaN, mouseY = NaN;   // cloud-local mouse position
  var isDragging = false;
  var hasMoved = false;             // distinguish drag from click
  var lastClientX = 0, lastClientY = 0;
  var rAF = null;
  var idleTimer = 0;
  var running = true;

  function clampRotX() {
    rotX = Math.max(MIN_ROT_X, Math.min(MAX_ROT_X, rotX));
  }

  /* --- Start drag --- */
  cloud.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    isDragging = true;
    hasMoved = false;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    cloud.classList.add('dragging');
    e.preventDefault();
    if (!rAF) rAF = requestAnimationFrame(animate);
  });

  /* --- Track mouse + rotate on drag --- */
  window.addEventListener('mousemove', function (e) {
    var rect = cloud.getBoundingClientRect();
    cx = rect.width / 2;
    cy = rect.height / 2;

    var inBounds =
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top && e.clientY <= rect.bottom;
    mouseX = inBounds ? e.clientX - rect.left : NaN;
    mouseY = inBounds ? e.clientY - rect.top : NaN;

    if (isDragging) {
      var dx = e.clientX - lastClientX;
      var dy = e.clientY - lastClientY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 1) hasMoved = true;
      rotY += dx * DRAG_SENSITIVITY;
      rotX += dy * DRAG_SENSITIVITY;
      clampRotX();
      rotVelY = dx * DRAG_SENSITIVITY * 0.5;
      rotVelX = dy * DRAG_SENSITIVITY * 0.5;
    }
    if (!rAF) rAF = requestAnimationFrame(animate);
  });

  /* --- End drag --- */
  window.addEventListener('mouseup', function () {
    if (!isDragging) return;
    isDragging = false;
    cloud.classList.remove('dragging');
  });

  /* --- Suppress tag navigation after a drag --- */
  cloud.addEventListener('click', function (e) {
    if (hasMoved) {
      e.preventDefault();
      e.stopPropagation();
      hasMoved = false;
    }
  });

  /* --- Animation loop --- */
  function animate() {
    if (!running) { rAF = null; return; }

    var hasMouse = !isNaN(mouseX) && !isNaN(mouseY);

    if (!isDragging) {
      // Inertia, then slow idle auto-rotation
      var speed = Math.abs(rotVelX) + Math.abs(rotVelY);
      if (speed > 0.00005) {
        rotY += rotVelY;
        rotX += rotVelX;
        rotVelX *= DRAG_INERTIA;
        rotVelY *= DRAG_INERTIA;
        clampRotX();
      } else {
        rotVelX = 0;
        rotVelY = 0;
        idleTimer += 0.016;
        rotY += AUTO_ROTATE_SPEED + Math.sin(idleTimer) * 0.0008;
        rotX += Math.cos(idleTimer * 0.6) * 0.0004;
        clampRotX();
      }
    }

    var maxVel = 0;

    for (var i = 0; i < tags.length; i++) {
      var tag = tags[i];
      var p = tag._p;

      // Screen-space repulsion on hover (disabled while dragging)
      if (hasMouse && !isDragging) {
        var proj = project(p.x, p.y, p.z);
        var dxs = proj.x - mouseX;
        var dys = proj.y - mouseY;
        var dsq = dxs * dxs + dys * dys;
        if (dsq < SCATTER_RADIUS * SCATTER_RADIUS && dsq > 0.01) {
          var d = Math.sqrt(dsq);
          var push = (1 - d / SCATTER_RADIUS) * SCATTER_STRENGTH;
          var ux = dxs / d, uy = dys / d;
          // Convert the screen-space push direction back into 3D using the
          // rotation basis vectors of the two screen axes.
          var bx = Math.cos(rotY), bz = Math.sin(rotY);
          var byx = Math.sin(rotY) * Math.sin(rotX);
          var byy = Math.cos(rotX);
          var byz = -Math.cos(rotY) * Math.sin(rotX);
          p.vx += push * (ux * bx + uy * byx);
          p.vy += push * (uy * byy);
          p.vz += push * (ux * bz + uy * byz);
        }
      }

      // Spring back to rest position
      p.vx += SPRING_K * (p.ox - p.x);
      p.vy += SPRING_K * (p.oy - p.y);
      p.vz += SPRING_K * (p.oz - p.z);

      // Damping + integrate
      p.vx *= DAMPING;
      p.vy *= DAMPING;
      p.vz *= DAMPING;
      p.x += p.vx;
      p.y += p.vy;
      p.z += p.vz;

      var vel = Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz);
      if (vel > maxVel) maxVel = vel;

      var final = project(p.x, p.y, p.z);
      if (final.scale < 0.05) {
        tag.style.display = 'none';
        continue;
      }

      tag.style.display = '';
      tag.style.setProperty('--tc-tx', Math.round(final.x) + 'px');
      tag.style.setProperty('--tc-ty', Math.round(final.y) + 'px');
      tag.style.setProperty('--tc-scale', final.scale.toFixed(4));
      // Depth sort: smaller depth (closer to viewer) renders ON TOP.
      tag.style.zIndex = String(Math.round((1 - final.depth) * 50));
      tag.style.opacity = String(Math.min(1, Math.max(0.2, final.scale * 1.1)));
    }

    if (maxVel > 0.0005 || hasMouse || isDragging) {
      rAF = requestAnimationFrame(animate);
    } else {
      rAF = null;
    }
  }

  /* --- Pause when off-screen --- */
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      running = entries[0].isIntersecting;
      if (running && !rAF) rAF = requestAnimationFrame(animate);
    }, { threshold: 0 });
    io.observe(cloud);
  }

  /* --- Resize / init --- */
  window.addEventListener('resize', function () {
    var rect = cloud.getBoundingClientRect();
    cx = rect.width / 2;
    cy = rect.height / 2;
  });

  var rect = cloud.getBoundingClientRect();
  cx = rect.width / 2;
  cy = rect.height / 2;
  rAF = requestAnimationFrame(animate);
})();
