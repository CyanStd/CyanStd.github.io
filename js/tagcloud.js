/* Warmpaper 3D Spherical Tag Cloud — inspired by DeepSeek Tags.
   Tags distributed on a sphere via Fibonacci lattice, projected to 2D.
   Mouse hover causes repulsion, other tags scatter naturally.
   Uses DOM elements for native clickability + CSS transforms for 60 FPS. */
(function () {
  'use strict';

  var cloud = document.querySelector('.tag-cloud-3d');
  if (!cloud) return;

  // Skip on mobile / non-hover devices
  if (window.matchMedia('(hover: none), (pointer: coarse)').matches) {
    // Leave the CSS fallback tag cloud visible
    cloud.classList.add('tag-cloud-fallback');
    return;
  }

  var tags = Array.prototype.slice.call(
    cloud.querySelectorAll('.tag-cloud-item')
  );
  if (!tags.length) return;

  /* --- Configuration --- */
  var SPHERE_RADIUS = 140;        // virtual 3D sphere radius (CSS px)
  var FOV = 600;                  // perspective distance
  var REPEL_RADIUS = 0.7;         // 3D distance threshold for repulsion
  var REPEL_STRENGTH = 0.035;     // repulsion force multiplier
  var SPRING_K = 0.025;           // spring stiffness toward rest position
  var DAMPING = 0.86;             // velocity decay per frame
  var ROTATE_SENSITIVITY = 0.8;   // mouse → rotation sensitivity

  /* --- Theme color --- */
  var root = document.documentElement;
  var themeObs = new MutationObserver(function () {
    var accent = getComputedStyle(root).getPropertyValue('--color-accent').trim() || '#DA7756';
    for (var i = 0; i < tags.length; i++) {
      tags[i].style.setProperty('--accent', accent);
    }
  });
  themeObs.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  /* --- Fibonacci sphere distribution --- */
  function fibonacciSphere(n) {
    var pts = [];
    var golden = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.39996 rad
    for (var i = 0; i < n; i++) {
      var y = 1 - (i / Math.max(0, n - 1)) * 2;
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
  var targetRotX = 0, targetRotY = 0;
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
    // Hide until first frame renders
    tag.style.visibility = 'visible';
  });

  /* --- Animation state --- */
  var lastMouseX = NaN, lastMouseY = NaN;
  var rAF = null;
  var autoRotTimer = 0;

  /* --- Animation loop --- */
  function animate() {
    var hasMouse = !isNaN(lastMouseX) && !isNaN(lastMouseY);
    var maxVel = 0;

    // Smooth rotation toward target
    if (hasMouse) {
      rotY += (targetRotY - rotY) * 0.08;
      rotX += (targetRotX - rotX) * 0.08;
      autoRotTimer = 0;
    } else {
      autoRotTimer += 0.012;
      rotY += (targetRotY - rotY) * 0.02 + Math.sin(autoRotTimer) * 0.0012;
      rotX += (targetRotX - rotX) * 0.02 + Math.cos(autoRotTimer * 0.7) * 0.0006;
    }

    for (var i = 0; i < tags.length; i++) {
      var tag = tags[i];
      var p = tag._p;

      if (hasMouse) {
        // Project mouse to 3D sphere plane
        var mx3d = (lastMouseX - cx) / SPHERE_RADIUS;
        var my3d = (lastMouseY - cy) / SPHERE_RADIUS;

        var dx = p.x - mx3d * 1.5;
        var dy = p.y - my3d * 1.5;
        var dz = p.z;
        var distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < REPEL_RADIUS * REPEL_RADIUS && distSq > 0.01) {
          var dist = Math.sqrt(distSq);
          var push = (REPEL_RADIUS - dist) * REPEL_STRENGTH;
          p.vx += (dx / dist) * push;
          p.vy += (dy / dist) * push;
          p.vz += (dz / dist) * push;
        }
      }

      // Spring: pull back to original sphere position
      p.vx += SPRING_K * (p.ox - p.x);
      p.vy += SPRING_K * (p.oy - p.y);
      p.vz += SPRING_K * (p.oz - p.z);

      // Damping
      p.vx *= DAMPING;
      p.vy *= DAMPING;
      p.vz *= DAMPING;

      // Integrate
      p.x += p.vx;
      p.y += p.vy;
      p.z += p.vz;

      var vel = Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz);
      if (vel > maxVel) maxVel = vel;

      // Project and apply transform
      var proj = project(p.x, p.y, p.z);
      if (proj.scale < 0.05) {
        tag.style.display = 'none';
        continue;
      }

      tag.style.display = '';
      // Update CSS variables (hover uses color/border/shadow, not transform scale)
      tag.style.setProperty('--tc-tx', Math.round(proj.x) + 'px');
      tag.style.setProperty('--tc-ty', Math.round(proj.y) + 'px');
      tag.style.setProperty('--tc-scale', proj.scale.toFixed(4));
      tag.style.zIndex = Math.round((proj.depth + 1) * 50);
      tag.style.opacity = String(Math.min(1, Math.max(0.15, proj.scale * 1.5)));
    }

    // Stop when everything settles
    if (maxVel < 0.001 && !hasMouse) {
      rAF = null;
    } else {
      rAF = requestAnimationFrame(animate);
    }
  }

  /* --- Mouse / touch interaction --- */
  var wrapper = cloud.parentElement;

  wrapper.addEventListener('mousemove', function (e) {
    var rect = cloud.getBoundingClientRect();
    lastMouseX = e.clientX - rect.left;
    lastMouseY = e.clientY - rect.top;
    cx = rect.width / 2;
    cy = rect.height / 2;

    // Map mouse to rotation target
    targetRotY = (lastMouseX - rect.width / 2) / rect.width * ROTATE_SENSITIVITY;
    targetRotX = (lastMouseY - rect.height / 2) / rect.height * ROTATE_SENSITIVITY * 0.5;

    if (!rAF) rAF = requestAnimationFrame(animate);
  });

  wrapper.addEventListener('mouseleave', function () {
    lastMouseX = NaN;
    lastMouseY = NaN;
  });

  /* --- Resize --- */
  window.addEventListener('resize', function () {
    // The project() function uses cx/cy from mousemove, but we also
    // set sensible defaults here for initial render.
    var rect = cloud.getBoundingClientRect();
    cx = rect.width / 2;
    cy = rect.height / 2;
  });

  /* --- Init --- */
  var rect = cloud.getBoundingClientRect();
  cx = rect.width / 2;
  cy = rect.height / 2;
  requestAnimationFrame(animate);
})();
