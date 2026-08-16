/* Warmpaper 3D Spherical Tag Cloud.
   Tags distributed on a sphere via Fibonacci lattice, projected to 2D.
   Interactions:
     - DRAG (mousedown + move) rotates the sphere via trackball/arcball
       rotation (quaternion-based, no gimbal lock, surface follows cursor),
       with inertia after release.
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
  var DRAG_INERTIA = 0.92;          // angular velocity decay after release
  var SCATTER_RADIUS = 120;         // px, screen-space radius of influence
  var SCATTER_STRENGTH = 0.02;      // 3D repulsion force multiplier
  var AUTO_ROTATE_SPEED = 0.0015;   // idle auto-rotation (rad/frame)

  /* --- Quaternion helpers (w, x, y, z) --- */
  function qRotate(v, q) {
    var w = q[0], x = q[1], y = q[2], z = q[3];
    var vx = v[0], vy = v[1], vz = v[2];
    // t = 2 * (q.xyz × v)
    var tx = 2 * (y * vz - z * vy);
    var ty = 2 * (z * vx - x * vz);
    var tz = 2 * (x * vy - y * vx);
    // v' = v + w*t + (q.xyz × t)
    return [
      vx + w * tx + (y * tz - z * ty),
      vy + w * ty + (z * tx - x * tz),
      vz + w * tz + (x * ty - y * tx)
    ];
  }

  function qMul(a, b) {
    return [
      a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
    ];
  }

  function qFromAxisAngle(ax, ay, az, angle) {
    var h = angle / 2, s = Math.sin(h);
    return [Math.cos(h), ax * s, ay * s, az * s];
  }

  function qNormalize(q) {
    var l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
    if (l === 0) return;
    q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
  }

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

  /* --- Orientation state + 3D → 2D projection --- */
  var orientation = [1, 0, 0, 0];   // accumulated rotation quaternion
  var cx, cy, cloudW, cloudH;

  function project(x, y, z) {
    var v = qRotate([x, y, z], orientation);
    var x1 = v[0], y1 = v[1], z2 = v[2];

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
  var dragAxis = [0, 1, 0];         // last drag rotation axis (for inertia)
  var dragSpeed = 0;                // last drag angular velocity
  var rAF = null;
  var idleTimer = 0;
  var running = true;

  /* --- Map screen point onto the trackball --- */
  function trackballPoint(localX, localY) {
    var r = (Math.min(cloudW, cloudH) / 2) * 0.7;
    if (r === 0) return [0, 0, 1];
    var x = (localX - cx) / r;
    var y = (localY - cy) / r;
    var d2 = x * x + y * y;
    if (d2 <= 1) {
      return [x, y, Math.sqrt(1 - d2)];
    }
    var len = Math.sqrt(d2);
    return [x / len, y / len, 0];
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

  /* --- Track mouse + rotate on drag (trackball) --- */
  window.addEventListener('mousemove', function (e) {
    var rect = cloud.getBoundingClientRect();
    cx = rect.width / 2;
    cy = rect.height / 2;
    cloudW = rect.width;
    cloudH = rect.height;

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

      // Arcball: rotation that takes the previous cursor point to the new one.
      var p1 = trackballPoint(e.clientX - rect.left, e.clientY - rect.top);
      var p0 = trackballPoint(e.clientX - rect.left - dx, e.clientY - rect.top - dy);
      var ax = p0[1] * p1[2] - p0[2] * p1[1];
      var ay = p0[2] * p1[0] - p0[0] * p1[2];
      var az = p0[0] * p1[1] - p0[1] * p1[0];
      var aLen = Math.sqrt(ax * ax + ay * ay + az * az);
      var dot = p0[0] * p1[0] + p0[1] * p1[1] + p0[2] * p1[2];

      if (aLen > 1e-6) {
        // Negate the angle so the sphere's surface follows the cursor
        // (grab-and-drag), instead of rotating against it.
        var ang = -Math.acos(Math.min(1, Math.max(-1, dot)));
        var dq = qFromAxisAngle(ax / aLen, ay / aLen, az / aLen, ang);
        orientation = qMul(dq, orientation);
        qNormalize(orientation);
        dragAxis = [ax / aLen, ay / aLen, az / aLen];
        dragSpeed = ang;
      }
    }
    if (!rAF) rAF = requestAnimationFrame(animate);
  });

  /* --- End drag --- */
  window.addEventListener('mouseup', function () {
    if (!isDragging) return;
    isDragging = false;
    cloud.classList.remove('dragging');
  });

  /* --- Clear hover when the pointer leaves the cloud --- */
  cloud.addEventListener('mouseleave', function () {
    mouseX = NaN;
    mouseY = NaN;
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
      if (Math.abs(dragSpeed) > 0.00005) {
        var dq = qFromAxisAngle(dragAxis[0], dragAxis[1], dragAxis[2], dragSpeed);
        orientation = qMul(dq, orientation);
        qNormalize(orientation);
        dragSpeed *= DRAG_INERTIA;
      } else {
        dragSpeed = 0;
        idleTimer += 0.016;
        var dq2 = qFromAxisAngle(0, 1, 0, AUTO_ROTATE_SPEED);
        orientation = qMul(dq2, orientation);
        qNormalize(orientation);
      }
    }

    // Basis vectors of the screen axes in object space (for screen→3D push)
    var bx = qRotate([1, 0, 0], orientation);
    var by = qRotate([0, 1, 0], orientation);

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
          p.vx += push * (ux * bx[0] + uy * by[0]);
          p.vy += push * (ux * bx[1] + uy * by[1]);
          p.vz += push * (ux * bx[2] + uy * by[2]);
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
    cloudW = rect.width;
    cloudH = rect.height;
  });

  var rect = cloud.getBoundingClientRect();
  cx = rect.width / 2;
  cy = rect.height / 2;
  cloudW = rect.width;
  cloudH = rect.height;
  rAF = requestAnimationFrame(animate);
})();
