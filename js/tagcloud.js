/* Warmpaper 3D Spherical Tag Cloud.
   Tags distributed on a sphere via Fibonacci lattice, projected to 2D.
   Interactions:
     - DRAG (mousedown + move) rotates the sphere via quaternion arcball
       (no gimbal lock, surface follows cursor) with release inertia.
     - HOVER empty space repels nearby tags (scatter).
     - HOVER a tag freezes the sphere, dims other tags and highlights the
       target so it can be clicked reliably; leaving resumes animation.
   Performance:
     - Quaternion converted to a 3x3 matrix once per frame; all points are
       projected with plain matrix multiplies (zero allocations).
     - Container rect cached (updated on scroll/resize/drag start).
     - Per-tag style writes skipped when values are unchanged. */
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
  var SCATTER_RADIUS = 100;         // px, screen-space radius of influence
  var SCATTER_STRENGTH = 0.01;      // gentle enough for the cursor to catch up
  var AUTO_ROTATE_SPEED = 0.0015;   // idle auto-rotation (rad/frame)
  var DIM_OPACITY = 0.12;           // opacity floor of non-selected tags
  var DIM_SPEED = 0.18;             // dim fade lerp factor per frame

  /* --- Quaternion helpers (w, x, y, z) --- */
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

  /* Unit quaternion -> column-major 3x3 rotation matrix.
     Columns are images of the unit basis vectors, so basisX = m[0..2] and
     basisY = m[3..5] map screen axes into object space. */
  function qToMatrix(q) {
    var w = q[0], x = q[1], y = q[2], z = q[3];
    var x2 = x + x, y2 = y + y, z2 = z + z;
    var xx = x * x2, xy = x * y2, xz = x * z2;
    var yy = y * y2, yz = y * z2, zz = z * z2;
    var wx = w * x2, wy = w * y2, wz = w * z2;
    return [
      1 - (yy + zz), xy + wz, xz - wy,
      xy - wz, 1 - (xx + zz), yz + wx,
      xz + wy, yz - wx, 1 - (xx + yy)
    ];
  }

  /* --- Fibonacci sphere distribution --- */
  function fibonacciSphere(n) {
    var pts = [];
    if (n === 1) return [{ x: 0, y: 0, z: 1 }];
    var golden = Math.PI * (3 - Math.sqrt(5)); // ~2.39996 rad
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

  /* --- State --- */
  var orientation = [1, 0, 0, 0];   // accumulated rotation quaternion
  var m = qToMatrix(orientation);   // rotation matrix, rebuilt each frame
  var cx = 0, cy = 0;               // sphere center (cloud-local)
  var rLeft = 0, rTop = 0, rW = 0, rH = 0; // cached container rect
  var rectDirty = false;

  function refreshRect() {
    var r = cloud.getBoundingClientRect();
    rLeft = r.left; rTop = r.top;
    rW = r.width; rH = r.height;
    cx = rW / 2;
    cy = rH / 2;
  }

  function invalidateRect() {
    rectDirty = true;
    // Keep cx/cy/rW/rH usable even if no frame runs while dirty.
    refreshRect();
  }

  /* Reusable projection result (zero allocation per call) */
  var proj = { x: 0, y: 0, scale: 0, depth: 0 };

  function project(x, y, z) {
    var x1 = m[0] * x + m[3] * y + m[6] * z;
    var y1 = m[1] * x + m[4] * y + m[7] * z;
    var z2 = m[2] * x + m[5] * y + m[8] * z;
    var fov = FOV / (FOV + z2 * SPHERE_RADIUS);
    proj.x = cx + x1 * SPHERE_RADIUS * fov;
    proj.y = cy + y1 * SPHERE_RADIUS * fov;
    proj.scale = fov * 0.8;
    proj.depth = z2;
    return proj;
  }

  /* --- Build tag state --- */
  var spherePoints = fibonacciSphere(tags.length);

  tags.forEach(function (tag, idx) {
    var sp = spherePoints[idx];
    tag._p = {
      ox: sp.x, oy: sp.y, oz: sp.z,
      x: sp.x, y: sp.y, z: sp.z,
      vx: 0, vy: 0, vz: 0,
      dim: 0,
      tx: NaN, ty: NaN, sc: '', zi: -1, op: ''
    };
    tag.style.visibility = 'visible';
  });

  /* --- Interaction state --- */
  var mouseX = NaN, mouseY = NaN;   // cloud-local mouse position
  var isDragging = false;
  var hasMoved = false;             // distinguish drag from click
  var focusTag = null;              // hovered tag (freeze state)
  var lastClientX = 0, lastClientY = 0;
  var dragAxis = [0, 1, 0];         // last drag rotation axis (inertia)
  var dragSpeed = 0;                // signed angular velocity
  var rAF = null;
  var idleTimer = 0;
  var running = true;

  function trackballPoint(clientX, clientY) {
    var r = (Math.min(rW, rH) / 2) * 0.7;
    if (!r) return [0, 0, 1];
    var x = (clientX - rLeft - cx) / r;
    var y = (clientY - rTop - cy) / r;
    var d2 = x * x + y * y;
    if (d2 <= 1) return [x, y, Math.sqrt(1 - d2)];
    var len = Math.sqrt(d2);
    return [x / len, y / len, 0];
  }

  /* --- Focus handling: hovering a tag freezes the sphere, dims the
         others and highlights the target for reliable clicking. --- */
  function setFocus(t) {
    if (focusTag === t) return;
    if (focusTag) focusTag.classList.remove('selecting');
    focusTag = t;
    t.classList.add('selecting');
    cloud.classList.add('selecting');
    dragSpeed = 0; // kill residual inertia so the target stays still
    // Cover the case where the loop is stopped (settled) and the pointer
    // is stationary: without this the dim fade would never start.
    if (!rAF && running) rAF = requestAnimationFrame(animate);
  }

  function clearFocus() {
    if (!focusTag) return;
    focusTag.classList.remove('selecting');
    focusTag = null;
    cloud.classList.remove('selecting');
  }

  /* --- Start drag --- */
  cloud.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    isDragging = true;
    hasMoved = false;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    cloud.classList.add('dragging');
    clearFocus();
    refreshRect();
    e.preventDefault();
    if (!rAF) rAF = requestAnimationFrame(animate);
  });

  /* --- Track mouse + rotate on drag (trackball) --- */
  window.addEventListener('mousemove', function (e) {
    var inBounds =
      e.clientX >= rLeft && e.clientX <= rLeft + rW &&
      e.clientY >= rTop && e.clientY <= rTop + rH;
    mouseX = inBounds ? e.clientX - rLeft : NaN;
    mouseY = inBounds ? e.clientY - rTop : NaN;

    if (isDragging) {
      var dx = e.clientX - lastClientX;
      var dy = e.clientY - lastClientY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 1) hasMoved = true;

      var p1 = trackballPoint(e.clientX, e.clientY);
      var p0 = trackballPoint(e.clientX - dx, e.clientY - dy);
      var ax = p0[1] * p1[2] - p0[2] * p1[1];
      var ay = p0[2] * p1[0] - p0[0] * p1[2];
      var az = p0[0] * p1[1] - p0[1] * p1[0];
      var aLen = Math.sqrt(ax * ax + ay * ay + az * az);
      var dot = p0[0] * p1[0] + p0[1] * p1[1] + p0[2] * p1[2];

      if (aLen > 1e-6) {
        // Negative angle: the sphere surface follows the cursor
        // (grab-and-drag) instead of rotating against it.
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

  /* --- End drag; re-detect the tag under the cursor --- */
  window.addEventListener('mouseup', function () {
    if (!isDragging) return;
    isDragging = false;
    cloud.classList.remove('dragging');
    if (running) {
      var el = document.elementFromPoint(lastClientX, lastClientY);
      var t = el && el.closest && el.closest('.tag-cloud-item');
      if (t) setFocus(t);
    }
  });

  /* --- Focus events (event delegation, cheap) --- */
  cloud.addEventListener('mouseover', function (e) {
    if (isDragging) return;
    var t = e.target.closest('.tag-cloud-item');
    if (t) setFocus(t);
  });

  cloud.addEventListener('mouseout', function (e) {
    var t = e.target.closest('.tag-cloud-item');
    if (!t || t !== focusTag) return;
    var to = e.relatedTarget;
    if (to && to.closest && to.closest('.tag-cloud-item')) return;
    clearFocus();
  });

  /* --- Clear hover when pointer leaves the cloud or the window --- */
  cloud.addEventListener('mouseleave', function () {
    mouseX = NaN;
    mouseY = NaN;
    clearFocus();
  });

  // relatedTarget === null means the pointer left the browser window:
  // without this, hasMouse would stay true forever and the rAF loop
  // would keep spinning (scatter + style churn) with stale coordinates.
  window.addEventListener('mouseout', function (e) {
    if (!e.relatedTarget) {
      mouseX = NaN;
      mouseY = NaN;
    }
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

    // Rotation: frozen while dragging (input drives it directly)
    // or while a tag is focused (stable click target).
    if (!isDragging && !focusTag) {
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

    m = qToMatrix(orientation);
    // Screen-axis basis vectors in object space (matrix columns)
    var bx0 = m[0], bx1 = m[1], bx2 = m[2];
    var by0 = m[3], by1 = m[4], by2 = m[5];

    var scatterActive = hasMouse && !isDragging && !focusTag;
    var maxVel = 0;

    for (var i = 0; i < tags.length; i++) {
      var tag = tags[i];
      var p = tag._p;
      var st = tag.style;

      // Screen-space repulsion on hover
      if (scatterActive) {
        var pr = project(p.x, p.y, p.z);
        var dxs = pr.x - mouseX;
        var dys = pr.y - mouseY;
        var dsq = dxs * dxs + dys * dys;
        if (dsq < SCATTER_RADIUS * SCATTER_RADIUS && dsq > 0.01) {
          var d = Math.sqrt(dsq);
          var push = (1 - d / SCATTER_RADIUS) * SCATTER_STRENGTH;
          var ux = dxs / d, uy = dys / d;
          p.vx += push * (ux * bx0 + uy * by0);
          p.vy += push * (ux * bx1 + uy * by1);
          p.vz += push * (ux * bx2 + uy * by2);
        }
      }

      // Spring back to rest position, damp, integrate
      p.vx += SPRING_K * (p.ox - p.x);
      p.vy += SPRING_K * (p.oy - p.y);
      p.vz += SPRING_K * (p.oz - p.z);
      p.vx *= DAMPING;
      p.vy *= DAMPING;
      p.vz *= DAMPING;
      p.x += p.vx;
      p.y += p.vy;
      p.z += p.vz;

      var vel = Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz);
      if (vel > maxVel) maxVel = vel;

      var f = project(p.x, p.y, p.z);
      if (f.scale < 0.05) {
        if (st.display !== 'none') st.display = 'none';
        continue;
      }
      if (st.display) st.display = '';

      // Write styles only when the rounded values actually change.
      var tx = Math.round(f.x), ty = Math.round(f.y);
      if (tx !== p.tx || ty !== p.ty) {
        st.setProperty('--tc-tx', tx + 'px');
        st.setProperty('--tc-ty', ty + 'px');
        p.tx = tx; p.ty = ty;
      }
      var sc = f.scale.toFixed(4);
      if (sc !== p.sc) {
        st.setProperty('--tc-scale', sc);
        p.sc = sc;
      }
      var zi = Math.round((1 - f.depth) * 50);
      if (zi !== p.zi) {
        st.zIndex = zi;
        p.zi = zi;
      }

      // Dim non-focused tags smoothly while one is selected
      var dimTarget = focusTag && tag !== focusTag ? 1 : 0;
      if (p.dim !== dimTarget) {
        p.dim += (dimTarget - p.dim) * DIM_SPEED;
        if (Math.abs(dimTarget - p.dim) < 0.01) p.dim = dimTarget;
      }
      var op = (Math.min(1, Math.max(0.2, f.scale * 1.1)) * (1 - p.dim) +
                DIM_OPACITY * p.dim).toFixed(2);
      if (op !== p.op) {
        st.opacity = op;
        p.op = op;
      }
    }

    if (maxVel > 0.0005 || hasMouse || isDragging || focusTag) {
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

  /* --- Resize / scroll: refresh the cached rect (coalesced per frame) --- */
  window.addEventListener('resize', invalidateRect);
  window.addEventListener('scroll', invalidateRect, { passive: true });

  /* --- Init --- */
  refreshRect();
  rAF = requestAnimationFrame(animate);
})();
