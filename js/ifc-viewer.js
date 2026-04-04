/**
 * IfcViewer — standalone IFC 3D viewer module for OpenDocs.
 * Loaded as an ES module script tag. Exposes window.IfcViewer.
 *
 * Public API:
 *   IfcViewer.render(arrayBuffer, container, fileName) -> Promise
 *   IfcViewer.cleanup()
 *
 * Dependencies (loaded via import map in index.html):
 *   - three (Three.js)
 *   - three/addons/ (OrbitControls)
 *   - web-ifc
 *   - web-ifc-three (IFCLoader)
 *   - three-mesh-bvh
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { IFCLoader } from 'web-ifc-three';
import * as WebIFC from 'web-ifc';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// Setup BVH for fast raycasting
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // State
  // ──────────────────────────────────────────────
  var _renderer = null;
  var _scene = null;
  var _camera = null;
  var _controls = null;
  var _animFrameId = null;
  var _ifcLoader = null;
  var _ifcModel = null;
  var _isEngineInit = false;
  var _container = null;
  var _resizeObs = null;

  // Selection
  var _highlightMaterial = new THREE.MeshLambertMaterial({
    color: 0xff3333,
    transparent: true,
    opacity: 0.8,
    depthTest: false
  });
  var _currentSelection = { modelID: null, id: null, subset: null };

  // Drag detection (prevent click on orbit)
  var _isDragging = false;
  var _mouseDownTime = 0;
  var _startX = 0;
  var _startY = 0;
  var CLICK_THRESHOLD_MS = 200;
  var DRAG_THRESHOLD_PX = 5;

  // Bound event handlers (for cleanup)
  var _onPointerDown = null;
  var _onPointerMove = null;
  var _onPointerUp = null;
  var _onResize = null;

  // Properties panel element
  var _propPanel = null;

  // ──────────────────────────────────────────────
  // Init IFC engine
  // ──────────────────────────────────────────────
  async function initEngine() {
    if (_isEngineInit) return;
    _ifcLoader = new IFCLoader();
    _ifcLoader.ifcManager.setWasmPath('https://unpkg.com/web-ifc@0.0.66/');
    await _ifcLoader.ifcManager.applyWebIfcConfig({
      COORDINATE_TO_ORIGIN: true,
      USE_FAST_BOOLS: true
    });
    _ifcLoader.ifcManager.setupThreeMeshBVH(
      'https://unpkg.com/three-mesh-bvh@0.5.23/build/index.module.js'
    );
    _isEngineInit = true;
  }

  // ──────────────────────────────────────────────
  // Scene setup
  // ──────────────────────────────────────────────
  function createScene(container) {
    var w = container.clientWidth;
    var h = container.clientHeight;

    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0x1a1a2e);

    _camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    _camera.position.set(0, 10, 20);

    _renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    _renderer.setSize(w, h);
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    var canvas = _renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    _controls = new OrbitControls(_camera, canvas);
    _controls.enableDamping = true;
    _controls.dampingFactor = 0.05;

    // Lights
    _scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    var dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(10, 20, 10);
    _scene.add(dirLight);

    // Grid + axes
    _scene.add(new THREE.GridHelper(100, 100, 0x444444, 0x555555));
    _scene.add(new THREE.AxesHelper(5));

    return canvas;
  }

  // ──────────────────────────────────────────────
  // Animation loop
  // ──────────────────────────────────────────────
  function animate() {
    _animFrameId = requestAnimationFrame(animate);
    if (_controls) _controls.update();
    if (_renderer && _scene && _camera) _renderer.render(_scene, _camera);
  }

  // ──────────────────────────────────────────────
  // Fit camera to model
  // ──────────────────────────────────────────────
  function fitCamera(model) {
    var box = new THREE.Box3().setFromObject(model);
    var center = box.getCenter(new THREE.Vector3());
    var size = box.getSize(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.y, size.z);

    _controls.target.copy(center);
    _camera.position.set(
      center.x + maxDim,
      center.y + maxDim / 2,
      center.z + maxDim
    );
    _camera.lookAt(center);
    _controls.update();
  }

  // ──────────────────────────────────────────────
  // Properties panel (embedded in container)
  // ──────────────────────────────────────────────
  function createPropPanel(container) {
    var panel = document.createElement('div');
    panel.className = 'ifc-prop-panel';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="ifc-prop-header">' +
      '  <span>Properties</span>' +
      '  <button class="ifc-prop-close" type="button" title="Close">&times;</button>' +
      '</div>' +
      '<div class="ifc-prop-body"></div>';
    container.appendChild(panel);

    panel.querySelector('.ifc-prop-close').addEventListener('click', function () {
      closePropPanel();
    });

    _propPanel = panel;
    return panel;
  }

  function closePropPanel() {
    if (_propPanel) _propPanel.hidden = true;
    if (_currentSelection.subset && _ifcModel && _ifcLoader) {
      _ifcLoader.ifcManager.removeSubset(_ifcModel.modelID, _highlightMaterial);
      _currentSelection.subset = null;
    }
  }

  function showProps(props) {
    if (!_propPanel) return;
    _propPanel.hidden = false;
    var body = _propPanel.querySelector('.ifc-prop-body');

    var name = (props.Name && props.Name.value) ? props.Name.value : 'Unnamed Element';
    var type = props.constructor.name.replace('Ifc', '').toUpperCase();

    var html =
      '<div class="ifc-prop-name">' + escHtml(name) + '</div>' +
      '<div class="ifc-prop-type">' + escHtml(type) + '</div>';

    for (var key in props) {
      var val = props[key];
      if (!val || typeof val === 'function' || val === null) continue;
      if (key === 'expressID' || key === 'type') continue;

      var displayVal = val.value !== undefined ? val.value : val;
      if (typeof displayVal === 'number') displayVal = Math.round(displayVal * 100) / 100;
      if (typeof displayVal === 'object') continue;

      html +=
        '<div class="ifc-prop-row">' +
        '  <span class="ifc-prop-key">' + escHtml(key) + '</span>' +
        '  <span class="ifc-prop-val" title="' + escHtml(String(displayVal)) + '">' + escHtml(String(displayVal)) + '</span>' +
        '</div>';
    }
    body.innerHTML = html;
  }

  function escHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ──────────────────────────────────────────────
  // Selection via raycasting
  // ──────────────────────────────────────────────
  function setupSelection(canvas) {
    var raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;
    var mouse = new THREE.Vector2();

    _onPointerDown = function (e) {
      _isDragging = false;
      _mouseDownTime = Date.now();
      _startX = e.clientX;
      _startY = e.clientY;
    };

    _onPointerMove = function (e) {
      if (Date.now() - _mouseDownTime > CLICK_THRESHOLD_MS ||
          Math.abs(e.clientX - _startX) > DRAG_THRESHOLD_PX ||
          Math.abs(e.clientY - _startY) > DRAG_THRESHOLD_PX) {
        _isDragging = true;
      }
    };

    _onPointerUp = async function (e) {
      if (_isDragging || !_ifcModel || !_ifcLoader) return;

      // Convert click coords to canvas-relative normalized device coords
      var rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, _camera);
      var intersects = raycaster.intersectObject(_ifcModel);

      if (intersects.length > 0) {
        var faceIndex = intersects[0].faceIndex;
        var geometry = intersects[0].object.geometry;
        var id = _ifcLoader.ifcManager.getExpressId(geometry, faceIndex);

        if (_currentSelection.subset) {
          _ifcLoader.ifcManager.removeSubset(_ifcModel.modelID, _highlightMaterial);
        }

        _currentSelection.subset = _ifcLoader.ifcManager.createSubset({
          modelID: _ifcModel.modelID,
          ids: [id],
          material: _highlightMaterial,
          scene: _scene,
          removePrevious: true
        });

        var props = await _ifcLoader.ifcManager.getItemProperties(_ifcModel.modelID, id);
        showProps(props);
      } else {
        closePropPanel();
      }
    };

    canvas.addEventListener('pointerdown', _onPointerDown);
    canvas.addEventListener('pointermove', _onPointerMove);
    canvas.addEventListener('pointerup', _onPointerUp);
  }

  // ──────────────────────────────────────────────
  // Status overlay
  // ──────────────────────────────────────────────
  function showStatus(container, msg, type) {
    var el = container.querySelector('.ifc-status');
    if (!el) {
      el = document.createElement('div');
      el.className = 'ifc-status';
      container.appendChild(el);
    }
    el.hidden = false;
    if (type === 'loading') {
      el.innerHTML = '<div class="ifc-spinner"></div><span>' + escHtml(msg) + '</span>';
      el.className = 'ifc-status ifc-status-loading';
    } else if (type === 'success') {
      el.innerHTML = '<span>' + escHtml(msg) + '</span>';
      el.className = 'ifc-status ifc-status-success';
      setTimeout(function () { el.hidden = true; }, 3000);
    } else {
      el.innerHTML = '<span>' + escHtml(msg) + '</span>';
      el.className = 'ifc-status ifc-status-error';
    }
  }

  function hideStatus(container) {
    var el = container.querySelector('.ifc-status');
    if (el) el.hidden = true;
  }

  // ──────────────────────────────────────────────
  // Main render function
  // ──────────────────────────────────────────────
  async function render(arrayBuffer, container, fileName) {
    cleanup();
    _container = container;
    container.innerHTML = '';
    container.style.position = 'relative';

    // Wrapper for the 3D canvas
    var wrapper = document.createElement('div');
    wrapper.className = 'ifc-viewer-wrapper';
    container.appendChild(wrapper);

    showStatus(container, 'Initializing 3D engine...', 'loading');

    try {
      await initEngine();

      var canvas = createScene(wrapper);
      wrapper.appendChild(canvas);

      // Resize observer
      _resizeObs = new ResizeObserver(function () {
        var w = wrapper.clientWidth;
        var h = wrapper.clientHeight;
        if (w > 0 && h > 0 && _camera && _renderer) {
          _camera.aspect = w / h;
          _camera.updateProjectionMatrix();
          _renderer.setSize(w, h);
        }
      });
      _resizeObs.observe(wrapper);

      // Start animation
      animate();

      // Setup selection
      setupSelection(canvas);

      // Create properties panel
      createPropPanel(container);

      // Load IFC from ArrayBuffer
      showStatus(container, 'Parsing IFC model...', 'loading');
      var blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
      var url = URL.createObjectURL(blob);

      _ifcModel = await _ifcLoader.loadAsync(url);
      URL.revokeObjectURL(url);

      _scene.add(_ifcModel);
      fitCamera(_ifcModel);

      // Count elements for status
      var cats = [
        WebIFC.IFCWALL, WebIFC.IFCWALLSTANDARDCASE, WebIFC.IFCSLAB,
        WebIFC.IFCWINDOW, WebIFC.IFCDOOR, WebIFC.IFCCOLUMN, WebIFC.IFCBEAM,
        WebIFC.IFCFURNISHINGELEMENT, WebIFC.IFCBUILDINGELEMENTPROXY, WebIFC.IFCROOF
      ];
      var totalCount = 0;
      for (var i = 0; i < cats.length; i++) {
        var items = await _ifcLoader.ifcManager.getAllItemsOfType(_ifcModel.modelID, cats[i], false);
        totalCount += items.length;
      }

      showStatus(container, 'Loaded — ' + totalCount + ' elements', 'success');

    } catch (err) {
      console.error('IFC Viewer error:', err);
      showStatus(container, 'Failed to load IFC: ' + (err.message || err), 'error');
    }
  }

  // ──────────────────────────────────────────────
  // Cleanup
  // ──────────────────────────────────────────────
  function cleanup() {
    if (_animFrameId) {
      cancelAnimationFrame(_animFrameId);
      _animFrameId = null;
    }
    if (_resizeObs) {
      _resizeObs.disconnect();
      _resizeObs = null;
    }
    if (_controls) {
      _controls.dispose();
      _controls = null;
    }
    if (_renderer) {
      _renderer.dispose();
      _renderer = null;
    }
    if (_container) {
      // Remove event listeners from canvas
      var canvas = _container.querySelector('canvas');
      if (canvas) {
        if (_onPointerDown) canvas.removeEventListener('pointerdown', _onPointerDown);
        if (_onPointerMove) canvas.removeEventListener('pointermove', _onPointerMove);
        if (_onPointerUp) canvas.removeEventListener('pointerup', _onPointerUp);
      }
    }
    _onPointerDown = null;
    _onPointerMove = null;
    _onPointerUp = null;
    _scene = null;
    _camera = null;
    _ifcModel = null;
    _currentSelection = { modelID: null, id: null, subset: null };
    _propPanel = null;
    if (_container) {
      _container.innerHTML = '';
      _container = null;
    }
  }

  // ──────────────────────────────────────────────
  // Expose public API
  // ──────────────────────────────────────────────
  window.IfcViewer = {
    render: render,
    cleanup: cleanup
  };

})();
