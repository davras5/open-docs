/**
 * DwgViewer — standalone DWG/DXF viewer module for OpenDocs.
 * Loaded as a regular script tag. Exposes window.DwgViewer.
 *
 * Public API:
 *   DwgViewer.render(arrayBuffer, container, fileName) -> Promise<cleanupFn>
 *   DwgViewer.cleanup()
 */
var DwgViewer = (function () {
  'use strict';

  // ──────────────────────────────────────────────
  // ACI Color Table
  // ──────────────────────────────────────────────
  var ACI = {
    0:'#000000', 1:'#FF0000', 2:'#FFFF00', 3:'#00FF00', 4:'#00FFFF',
    5:'#0000FF', 6:'#FF00FF', 7:'#FFFFFF', 8:'#808080', 9:'#C0C0C0',
    10:'#FF0000', 11:'#FF7F7F', 12:'#CC0000', 20:'#FF3F00', 21:'#FF9F7F',
    30:'#FF7F00', 31:'#FFBF7F', 40:'#FFBF00', 41:'#FFDF7F', 50:'#FFFF00',
    51:'#FFFF7F', 60:'#BFFF00', 70:'#7FFF00', 80:'#3FFF00', 90:'#00FF00',
    100:'#00FF3F', 110:'#00FF7F', 120:'#00FFBF', 130:'#00FFFF',
    140:'#00BFFF', 150:'#007FFF', 160:'#003FFF', 170:'#0000FF',
    180:'#3F00FF', 190:'#7F00FF', 200:'#BF00FF', 210:'#FF00FF',
    220:'#FF007F', 230:'#FF003F', 240:'#FF0000', 250:'#4C4C4C',
    251:'#808080', 252:'#A0A0A0', 253:'#C0C0C0', 254:'#E0E0E0',
    255:'#FFFFFF', 256:'#CCCCCC'
  };

  function aciToHex(i) {
    return ACI[i] || 'hsl(' + ((i * 137) % 360) + ', 60%, 50%)';
  }

  // ──────────────────────────────────────────────
  // LibreDWG WASM loader
  // ──────────────────────────────────────────────
  var _lib = null;

  async function initLib() {
    if (_lib) return _lib;
    var mod = await import('https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.6.6/dist/libredwg-web.js');
    _lib = await mod.LibreDwg.create();
    return _lib;
  }

  // ──────────────────────────────────────────────
  // Parse pipeline
  // ──────────────────────────────────────────────
  async function parseDwg(buffer, isDxf) {
    var dwgLib = await initLib();
    var fileType = isDxf ? 1 : 0;
    var dwgPtr = dwgLib.dwg_read_data(buffer, fileType);
    if (dwgPtr == null) throw new Error('Failed to parse DWG file');
    var result = dwgLib.convertEx(dwgPtr);
    try { dwgLib.dwg_free(dwgPtr); } catch (e) { /* ignore */ }
    return result.database;
  }

  // ──────────────────────────────────────────────
  // Prepare drawing data — entity processing
  // ──────────────────────────────────────────────
  function prepareDrawingData(db) {
    var entities = db.entities || [];
    var layers = (db.tables && db.tables.LAYER && db.tables.LAYER.entries) || [];

    var layerColorMap = {};
    var layerSet = {};
    for (var i = 0; i < layers.length; i++) {
      layerColorMap[layers[i].name] = aciToHex(layers[i].colorIndex);
      layerSet[layers[i].name] = true;
    }

    function getColor(e) {
      if (e.colorIndex && e.colorIndex !== 256 && e.colorIndex !== 0) return aciToHex(e.colorIndex);
      return layerColorMap[e.layer] || '#CCCCCC';
    }

    // STYLE table for text font mapping
    var styleFontMap = {};
    var styleEntries = (db.tables && db.tables.STYLE && db.tables.STYLE.entries) || [];
    for (var i = 0; i < styleEntries.length; i++) {
      var s = styleEntries[i];
      if (s.name) styleFontMap[s.name] = s.fontName || s.bigFontName || s.fileName || '';
    }

    // BLOCK_RECORD table for INSERT expansion
    var blockMap = {};
    var blockRecords = (db.tables && db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) || [];
    for (var i = 0; i < blockRecords.length; i++) {
      var br = blockRecords[i];
      if (br.name && br.entities && br.entities.length > 0) blockMap[br.name] = br;
    }

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function expand(x, y) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    var renderList = [];

    function transformPoint(px, py, ins) {
      var sx = (ins.xScale || 1);
      var sy = (ins.yScale || 1);
      var rot = (ins.rotation || 0);
      var cos = Math.cos(rot);
      var sin = Math.sin(rot);
      var bx = ins.baseX || 0;
      var by = ins.baseY || 0;
      var rx = (px - bx) * sx;
      var ry = (py - by) * sy;
      return {
        x: rx * cos - ry * sin + ins.insertionPoint.x,
        y: rx * sin + ry * cos + ins.insertionPoint.y
      };
    }

    function addEntity(e, tf, parentLayer) {
      if (e.isVisible === 1) return;
      var color = getColor(e);
      var l = e.layer || parentLayer || '0';
      var tfMirrored = tf && ((tf.xScale || 1) * (tf.yScale || 1)) < 0;
      var tfSxNeg = tf && (tf.xScale || 1) < 0;

      // Track layers seen via entities
      if (l) layerSet[l] = true;

      function tp(px, py) {
        if (!tf) return { x: px, y: py };
        return transformPoint(px, py, tf);
      }

      switch (e.type) {

        // ── LINE ──
        case 'LINE': {
          if (e.startPoint && e.endPoint) {
            var p1 = tp(e.startPoint.x, e.startPoint.y);
            var p2 = tp(e.endPoint.x, e.endPoint.y);
            expand(p1.x, p1.y); expand(p2.x, p2.y);
            renderList.push({ t: 'line', l: l, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, c: color });
          }
          break;
        }

        // ── LWPOLYLINE ──
        case 'LWPOLYLINE': {
          if (e.vertices && e.vertices.length > 1) {
            var verts = tf
              ? e.vertices.map(function (v) { var p = tp(v.x, v.y); return { x: p.x, y: p.y, bulge: tfMirrored ? -(v.bulge || 0) : v.bulge }; })
              : e.vertices;
            for (var vi = 0; vi < verts.length; vi++) expand(verts[vi].x, verts[vi].y);
            var closed = !!(e.flag & 512) || !!(e.flag & 1);
            if (!closed && verts.length > 2) {
              var f = verts[0], la = verts[verts.length - 1];
              if (Math.abs(f.x - la.x) < 1e-6 && Math.abs(f.y - la.y) < 1e-6) closed = true;
            }
            renderList.push({ t: 'poly', l: l, verts: verts, closed: closed, c: color });
          }
          break;
        }

        // ── POLYLINE2D ──
        case 'POLYLINE2D': {
          if (e.vertices && e.vertices.length > 1) {
            var verts = e.vertices.map(function (v) {
              var p = tp(v.x, v.y);
              return { x: p.x, y: p.y, bulge: tfMirrored ? -(v.bulge || 0) : (v.bulge || 0) };
            });
            for (var vi = 0; vi < verts.length; vi++) expand(verts[vi].x, verts[vi].y);
            var closed = !!(e.flag & 512) || !!(e.flag & 1);
            renderList.push({ t: 'poly', l: l, verts: verts, closed: closed, c: color });
          }
          break;
        }

        // ── POLYLINE3D ──
        case 'POLYLINE3D': {
          if (e.vertices && e.vertices.length > 1) {
            var verts = e.vertices.map(function (v) {
              var p = tp(v.x, v.y);
              return { x: p.x, y: p.y, bulge: 0 };
            });
            for (var vi = 0; vi < verts.length; vi++) expand(verts[vi].x, verts[vi].y);
            var closed = !!(e.flag & 512) || !!(e.flag & 1);
            renderList.push({ t: 'poly', l: l, verts: verts, closed: closed, c: color });
          }
          break;
        }

        // ── CIRCLE ──
        case 'CIRCLE': {
          if (e.center && e.radius) {
            var c = tp(e.center.x, e.center.y);
            var r = e.radius * Math.abs(tf ? (tf.xScale || 1) : 1);
            expand(c.x - r, c.y - r); expand(c.x + r, c.y + r);
            renderList.push({ t: 'circle', l: l, cx: c.x, cy: c.y, r: r, c: color });
          }
          break;
        }

        // ── ARC ──
        case 'ARC': {
          if (e.center && e.radius != null && e.startAngle != null && e.endAngle != null) {
            var c = tp(e.center.x, e.center.y);
            var r = e.radius * Math.abs(tf ? (tf.xScale || 1) : 1);
            var rotOff = tf ? (tf.rotation || 0) : 0;
            var sa, ea;
            if (tfMirrored) {
              if (tfSxNeg) {
                sa = Math.PI - e.endAngle + rotOff;
                ea = Math.PI - e.startAngle + rotOff;
              } else {
                sa = -e.endAngle + rotOff;
                ea = -e.startAngle + rotOff;
              }
            } else {
              sa = e.startAngle + rotOff;
              ea = e.endAngle + rotOff;
            }
            expand(c.x - r, c.y - r); expand(c.x + r, c.y + r);
            renderList.push({ t: 'arc', l: l, cx: c.x, cy: c.y, r: r, sa: sa, ea: ea, c: color });
          }
          break;
        }

        // ── ELLIPSE ──
        case 'ELLIPSE': {
          if (e.center && e.majorAxisEndPoint) {
            var c = tp(e.center.x, e.center.y);
            var sx = tf ? (tf.xScale || 1) : 1;
            var sy = tf ? (tf.yScale || 1) : 1;
            var mx = e.majorAxisEndPoint.x * sx;
            var my = e.majorAxisEndPoint.y * sy;
            var rx = Math.hypot(mx, my);
            var ry = rx * (e.axisRatio || e.minorToMajorRatio || 0.5);
            var rot = Math.atan2(my, mx) + (tf ? (tf.rotation || 0) : 0);
            expand(c.x - rx, c.y - rx); expand(c.x + rx, c.y + rx);
            renderList.push({ t: 'ellipse', l: l, cx: c.x, cy: c.y, rx: rx, ry: ry, rot: rot, c: color });
          }
          break;
        }

        // ── SPLINE ──
        case 'SPLINE': {
          var pts = null;
          if (e.fitPoints && e.fitPoints.length > 1) pts = e.fitPoints;
          else if (e.controlPoints && e.controlPoints.length > 1) pts = e.controlPoints;
          if (pts) {
            var verts = pts.map(function (p) { var tp2 = tp(p.x, p.y); return { x: tp2.x, y: tp2.y, bulge: 0 }; });
            for (var vi = 0; vi < verts.length; vi++) expand(verts[vi].x, verts[vi].y);
            var closed = !!(e.flag & 512) || !!(e.flag & 1);
            renderList.push({ t: 'poly', l: l, verts: verts, closed: closed, c: color });
          }
          break;
        }

        // ── TEXT ──
        case 'TEXT': {
          if (!e.text) break;
          var useEnd = ((e.halign || 0) > 0 || (e.valign || 0) > 0);
          var pt = useEnd ? (e.endPoint || e.startPoint) : (e.startPoint || e.insertionPoint);
          if (!pt) break;
          var p = tp(pt.x, pt.y);
          var scale = Math.abs(tf ? (tf.xScale || 1) : 1);
          var rotRad = (e.rotation || 0) + (tf ? (tf.rotation || 0) : 0);
          expand(p.x, p.y);
          renderList.push({ t: 'text', l: l, x: p.x, y: p.y, text: e.text, h: (e.textHeight || 2.5) * scale, rot: rotRad, c: color });
          break;
        }

        // ── MTEXT ──
        case 'MTEXT': {
          var pt = e.insertionPoint;
          if (pt && e.text) {
            var p = tp(pt.x, pt.y);
            var scale = Math.abs(tf ? (tf.xScale || 1) : 1);
            var rotRad = (e.rotation || 0) + (tf ? (tf.rotation || 0) : 0);
            expand(p.x, p.y);
            var clean = e.text
              .replace(/\\P/g, '\n')
              .replace(/\\~/g, ' ')
              .replace(/\\[fFHWACcTQpq][^;]*;/g, '')
              .replace(/\\S([^^;]*)\^([^;]*);/g, '$1/$2')
              .replace(/\\[LlOoKk]/g, '')
              .replace(/[{}]/g, '')
              .replace(/\\\\/g, '\\');
            renderList.push({ t: 'text', l: l, x: p.x, y: p.y, text: clean, h: (e.textHeight || 2.5) * scale, rot: rotRad, c: color });
          }
          break;
        }

        // ── ATTRIB ──
        case 'ATTRIB': {
          if (e.flags && (e.flags & 1)) break;
          var tb = (typeof e.text === 'object' && e.text !== null) ? e.text : null;
          var textStr = tb ? tb.text : (typeof e.text === 'string' ? e.text : null);
          if (!textStr) break;
          var halign = tb ? (tb.halign || 0) : (e.halign || 0);
          var valign = tb ? (tb.valign || 0) : (e.valign || 0);
          var useEnd = (halign > 0 || valign > 0);
          var pt = useEnd
            ? (e.alignmentPoint || (tb && tb.endPoint) || e.endPoint || (tb && tb.startPoint) || e.insertionPoint)
            : ((tb && tb.startPoint) || e.insertionPoint || (tb && tb.endPoint) || e.startPoint);
          if (!pt) break;
          var p = tp(pt.x, pt.y);
          var scale = Math.abs(tf ? (tf.xScale || 1) : 1);
          var rotation = (tb && tb.rotation) || e.rotation || 0;
          var rotRad = rotation + (tf ? (tf.rotation || 0) : 0);
          expand(p.x, p.y);
          var tHeight = (tb && tb.textHeight) || e.textHeight || 2.5;
          renderList.push({ t: 'text', l: l, x: p.x, y: p.y, text: textStr, h: tHeight * scale, rot: rotRad, c: color });
          break;
        }

        // ── POINT ──
        case 'POINT': {
          var pt = e.location || e.point || e;
          if (pt && pt.x != null) {
            var p = tp(pt.x, pt.y);
            expand(p.x, p.y);
            renderList.push({ t: 'point', l: l, x: p.x, y: p.y, c: color });
          }
          break;
        }

        // ── SOLID / 3DSOLID / TRACE ──
        case 'SOLID':
        case '3DSOLID':
        case 'TRACE': {
          var pts = [e.firstCorner || e.point1, e.secondCorner || e.point2,
                     e.thirdCorner || e.point3, e.fourthCorner || e.point4].filter(Boolean);
          if (pts.length >= 3) {
            var tpts = pts.map(function (p) { return tp(p.x, p.y); });
            for (var pi = 0; pi < tpts.length; pi++) expand(tpts[pi].x, tpts[pi].y);
            renderList.push({ t: 'solid', l: l, pts: tpts, c: color });
          }
          break;
        }

        // ── HATCH ──
        case 'HATCH': {
          var boundaries = e.boundaryPaths || [];
          var isSolidFill = e.isSolidFill || (e.patternName === 'SOLID') || (e.style === 1);
          var paths = [];
          for (var bi = 0; bi < boundaries.length; bi++) {
            var bp = boundaries[bi];

            // Edge-based boundary paths
            if (bp.edges && bp.edges.length > 0) {
              var verts = [];
              for (var ei = 0; ei < bp.edges.length; ei++) {
                var edge = bp.edges[ei];
                var etype = edge.type != null ? edge.type : (edge.edgeType != null ? edge.edgeType : -1);

                if (etype === 1) {
                  // Line edge
                  var sp = tp(
                    edge.startPoint ? edge.startPoint.x : edge.start.x,
                    edge.startPoint ? edge.startPoint.y : edge.start.y
                  );
                  var ep = tp(
                    edge.endPoint ? edge.endPoint.x : edge.end.x,
                    edge.endPoint ? edge.endPoint.y : edge.end.y
                  );
                  if (verts.length === 0) verts.push(sp);
                  verts.push(ep);
                } else if (etype === 2) {
                  // Arc edge
                  var cx = edge.center ? edge.center.x : 0;
                  var cy = edge.center ? edge.center.y : 0;
                  var r = edge.radius || 0;
                  var sa = edge.startAngle || 0;
                  var ea = edge.endAngle || Math.PI * 2;
                  var ccw = tfMirrored ? (edge.isCCW === false) : (edge.isCCW !== false);
                  var sweep = ccw ? (ea - sa) : (sa - ea);
                  if (sweep <= 0) sweep += Math.PI * 2;
                  var steps = Math.max(12, Math.ceil(Math.abs(sweep) / (Math.PI / 16)));
                  for (var si = 0; si <= steps; si++) {
                    var frac = si / steps;
                    var angle = ccw ? (sa + sweep * frac) : (sa - sweep * frac);
                    var pt = tp(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
                    if (si === 0 && verts.length > 0) {
                      var last = verts[verts.length - 1];
                      if (Math.abs(last.x - pt.x) < 1e-4 && Math.abs(last.y - pt.y) < 1e-4) continue;
                    }
                    verts.push(pt);
                  }
                } else if (etype === 3) {
                  // Ellipse arc edge
                  var cx = edge.center ? edge.center.x : 0;
                  var cy = edge.center ? edge.center.y : 0;
                  var majorEnd = edge.majorAxisEndPoint || edge.endMajorAxis || { x: 1, y: 0 };
                  var majorLen = Math.hypot(majorEnd.x, majorEnd.y);
                  var minorLen = (edge.lengthOfMinorAxis || 0.5) * (majorLen || 1);
                  var rot = Math.atan2(majorEnd.y, majorEnd.x);
                  var sa = edge.startAngle || 0;
                  var ea = edge.endAngle || Math.PI * 2;
                  var ccw = edge.isCCW !== false;
                  var sweep = ccw ? (ea - sa) : (sa - ea);
                  if (sweep <= 0) sweep += Math.PI * 2;
                  var steps = Math.max(12, Math.ceil(Math.abs(sweep) / (Math.PI / 16)));
                  for (var si = 0; si <= steps; si++) {
                    var frac = si / steps;
                    var angle = ccw ? (sa + sweep * frac) : (sa - sweep * frac);
                    var lx = majorLen * Math.cos(angle);
                    var ly = minorLen * Math.sin(angle);
                    var px = cx + lx * Math.cos(rot) - ly * Math.sin(rot);
                    var py = cy + lx * Math.sin(rot) + ly * Math.cos(rot);
                    var pt = tp(px, py);
                    if (si === 0 && verts.length > 0) {
                      var last = verts[verts.length - 1];
                      if (Math.abs(last.x - pt.x) < 1e-4 && Math.abs(last.y - pt.y) < 1e-4) continue;
                    }
                    verts.push(pt);
                  }
                } else if (etype === 4) {
                  // Spline edge
                  var pts = edge.fitDatum || edge.controlPoints || [];
                  for (var si = 0; si < pts.length; si++) {
                    var sp = pts[si];
                    var pt = tp(sp.x, sp.y);
                    if (si === 0 && verts.length > 0) {
                      var last = verts[verts.length - 1];
                      if (Math.abs(last.x - pt.x) < 1e-4 && Math.abs(last.y - pt.y) < 1e-4) continue;
                    }
                    verts.push(pt);
                  }
                }
              }
              if (verts.length > 1) {
                for (var vi = 0; vi < verts.length; vi++) expand(verts[vi].x, verts[vi].y);
                var polyVerts = verts.map(function (v) { return { x: v.x, y: v.y, bulge: 0 }; });
                renderList.push({ t: 'poly', l: l, verts: polyVerts, closed: true, c: color });
                if (isSolidFill) paths.push(polyVerts);
              }
            }

            // Vertex-based boundary paths
            if (bp.vertices && bp.vertices.length > 1) {
              var verts = tf
                ? bp.vertices.map(function (v) { var p = tp(v.x, v.y); return { x: p.x, y: p.y, bulge: v.bulge || 0 }; })
                : bp.vertices.map(function (v) { return { x: v.x, y: v.y, bulge: v.bulge || 0 }; });
              for (var vi = 0; vi < verts.length; vi++) expand(verts[vi].x, verts[vi].y);
              var closed = bp.isClosed !== false;
              renderList.push({ t: 'poly', l: l, verts: verts, closed: closed, c: color });
              if (isSolidFill) paths.push(verts);
            }
          }
          if (isSolidFill && paths.length > 0) {
            renderList.push({ t: 'hatchfill', l: l, paths: paths, c: color });
          }
          break;
        }

        // ── DIMENSION ──
        case 'DIMENSION': {
          if (e.name && blockMap[e.name]) {
            var block = blockMap[e.name];
            var ins = {
              insertionPoint: tf ? transformPoint(0, 0, tf) : { x: 0, y: 0 },
              xScale: tf ? (tf.xScale || 1) : 1,
              yScale: tf ? (tf.yScale || 1) : 1,
              rotation: tf ? (tf.rotation || 0) : 0
            };
            for (var bei = 0; bei < block.entities.length; bei++) {
              addEntity(block.entities[bei], ins, l);
            }
          } else {
            var pts = [];
            if (e.definitionPoint) pts.push(e.definitionPoint);
            if (e.subDefinitionPoint1) pts.push(e.subDefinitionPoint1);
            if (e.subDefinitionPoint2) pts.push(e.subDefinitionPoint2);
            for (var pi = 0; pi + 1 < pts.length; pi++) {
              var p1 = tp(pts[pi].x, pts[pi].y);
              var p2 = tp(pts[pi + 1].x, pts[pi + 1].y);
              expand(p1.x, p1.y); expand(p2.x, p2.y);
              renderList.push({ t: 'line', l: l, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, c: color });
            }
            if (e.textPoint && e.measurement != null) {
              var p = tp(e.textPoint.x, e.textPoint.y);
              expand(p.x, p.y);
              var txt = e.text || e.measurement.toFixed(0);
              renderList.push({ t: 'text', l: l, x: p.x, y: p.y, text: txt, h: 2.5, rot: 0, c: color });
            }
          }
          break;
        }

        // ── LEADER ──
        case 'LEADER': {
          if (e.vertices && e.vertices.length > 1) {
            var verts = e.vertices.map(function (v) { var p = tp(v.x, v.y); return { x: p.x, y: p.y, bulge: 0 }; });
            for (var vi = 0; vi < verts.length; vi++) expand(verts[vi].x, verts[vi].y);
            renderList.push({ t: 'poly', l: l, verts: verts, closed: false, c: color });
          }
          break;
        }

        // ── MLINE ──
        case 'MLINE': {
          if (e.vertices && e.vertices.length > 1) {
            var verts = e.vertices.map(function (v) {
              var pt = v.point || v;
              var p = tp(pt.x, pt.y);
              return { x: p.x, y: p.y, bulge: 0 };
            });
            for (var vi = 0; vi < verts.length; vi++) expand(verts[vi].x, verts[vi].y);
            renderList.push({ t: 'poly', l: l, verts: verts, closed: false, c: color });
          }
          break;
        }

        // ── 3DFACE ──
        case '3DFACE': {
          var pts = [e.firstCorner, e.secondCorner, e.thirdCorner, e.fourthCorner].filter(Boolean);
          if (pts.length >= 3) {
            var tpts = pts.map(function (p) { return tp(p.x, p.y); });
            for (var pi = 0; pi < tpts.length; pi++) expand(tpts[pi].x, tpts[pi].y);
            var verts = tpts.map(function (p) { return { x: p.x, y: p.y, bulge: 0 }; });
            renderList.push({ t: 'poly', l: l, verts: verts, closed: true, c: color });
          }
          break;
        }

        // ── RAY ──
        case 'RAY': {
          if (e.basePoint && e.direction) {
            var p1 = tp(e.basePoint.x, e.basePoint.y);
            var len = 1e6;
            var p2 = tp(e.basePoint.x + e.direction.x * len, e.basePoint.y + e.direction.y * len);
            expand(p1.x, p1.y);
            renderList.push({ t: 'line', l: l, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, c: color });
          }
          break;
        }

        // ── XLINE ──
        case 'XLINE': {
          if (e.basePoint && e.direction) {
            var len = 1e6;
            var p1 = tp(e.basePoint.x - e.direction.x * len, e.basePoint.y - e.direction.y * len);
            var p2 = tp(e.basePoint.x + e.direction.x * len, e.basePoint.y + e.direction.y * len);
            renderList.push({ t: 'line', l: l, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, c: color });
          }
          break;
        }

        // ── INSERT (Block reference) ──
        case 'INSERT': {
          if (!e.insertionPoint || !e.name) break;
          var block = blockMap[e.name];
          if (!block || !block.entities) break;

          // Handle OCS extrusion (Z normal = -1)
          var ipx = e.insertionPoint.x;
          var ipy = e.insertionPoint.y;
          var eXScale = e.xScale != null ? e.xScale : 1;
          var eYScale = e.yScale != null ? e.yScale : 1;
          var eRotation = e.rotation || 0;
          var ez = e.extrusionDirection ? e.extrusionDirection.z : null;
          if (ez != null && ez < 0) {
            ipx = -ipx;
            eYScale = -eYScale;
            eRotation = Math.PI - eRotation;
          }

          var origin = block.origin || block.basePoint;
          var ins = {
            insertionPoint: tf ? transformPoint(ipx, ipy, tf) : { x: ipx, y: ipy },
            xScale: eXScale * (tf ? (tf.xScale || 1) : 1),
            yScale: eYScale * (tf ? (tf.yScale || 1) : 1),
            rotation: eRotation + (tf ? (tf.rotation || 0) : 0),
            baseX: origin ? origin.x : 0,
            baseY: origin ? origin.y : 0
          };

          var hasAttribs = e.attribs && e.attribs.length > 0;
          for (var bei = 0; bei < block.entities.length; bei++) {
            if (block.entities[bei].type === 'ATTDEF' || block.entities[bei].type === 'ATTRIB') continue;
            addEntity(block.entities[bei], ins, l);
          }
          if (hasAttribs) {
            for (var ai = 0; ai < e.attribs.length; ai++) {
              addEntity(e.attribs[ai], tf, l);
            }
          }
          break;
        }
      }
    }

    // Process all entities
    for (var i = 0; i < entities.length; i++) {
      if (entities[i].type === 'ATTRIB' || entities[i].type === 'ATTDEF') continue;
      addEntity(entities[i], null, null);
    }

    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 1000; maxY = 1000; }

    return {
      renderList: renderList,
      bounds: { minX: minX, minY: minY, maxX: maxX, maxY: maxY },
      layerCount: Object.keys(layerSet).length
    };
  }

  // ──────────────────────────────────────────────
  // Canvas renderer
  // ──────────────────────────────────────────────
  function drawBulgeArc(ctx, x1, y1, x2, y2, bulge) {
    var dx = x2 - x1, dy = y2 - y1;
    var d = Math.hypot(dx, dy);
    if (d < 1e-10) { ctx.lineTo(x2, y2); return; }
    var sagitta = Math.abs(bulge) * d / 2;
    var radius = ((d / 2) * (d / 2) + sagitta * sagitta) / (2 * sagitta);
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    var nx = -dy / d, ny = dx / d;
    var sign = bulge > 0 ? 1 : -1;
    var offset = sign * (radius - sagitta);
    var cx = mx + nx * offset, cy = my + ny * offset;
    var sa = Math.atan2(y1 - cy, x1 - cx);
    var ea = Math.atan2(y2 - cy, x2 - cx);
    ctx.arc(cx, cy, Math.abs(radius), sa, ea, bulge < 0);
  }

  function renderCanvas(canvas, drawingData, cam) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var dpr = window.devicePixelRatio || 1;
    w = w / dpr;
    h = h / dpr;

    // Clear with dark background
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    var renderList = drawingData.renderList;

    // World -> screen transform
    ctx.translate(w / 2, h / 2);
    ctx.scale(cam.zoom, -cam.zoom); // Y-flip
    ctx.translate(-cam.x, -cam.y);
    ctx.lineWidth = 1 / cam.zoom;

    for (var i = 0; i < renderList.length; i++) {
      var item = renderList[i];
      ctx.strokeStyle = item.c;
      ctx.fillStyle = item.c;

      switch (item.t) {
        case 'line':
          ctx.beginPath();
          ctx.moveTo(item.x1, item.y1);
          ctx.lineTo(item.x2, item.y2);
          ctx.stroke();
          break;

        case 'poly':
          ctx.beginPath();
          ctx.moveTo(item.verts[0].x, item.verts[0].y);
          for (var vi = 1; vi < item.verts.length; vi++) {
            var v = item.verts[vi];
            var prev = item.verts[vi - 1];
            if (prev.bulge && prev.bulge !== 0) {
              drawBulgeArc(ctx, prev.x, prev.y, v.x, v.y, prev.bulge);
            } else {
              ctx.lineTo(v.x, v.y);
            }
          }
          if (item.closed && item.verts.length > 1) {
            var last = item.verts[item.verts.length - 1];
            var first = item.verts[0];
            if (last.bulge && last.bulge !== 0) {
              drawBulgeArc(ctx, last.x, last.y, first.x, first.y, last.bulge);
            } else {
              ctx.lineTo(first.x, first.y);
            }
          }
          ctx.stroke();
          break;

        case 'circle':
          ctx.beginPath();
          ctx.arc(item.cx, item.cy, item.r, 0, Math.PI * 2);
          ctx.stroke();
          break;

        case 'arc':
          ctx.beginPath();
          ctx.arc(item.cx, item.cy, item.r, item.sa, item.ea, false);
          ctx.stroke();
          break;

        case 'ellipse':
          ctx.beginPath();
          ctx.ellipse(item.cx, item.cy, item.rx, item.ry, item.rot, 0, Math.PI * 2);
          ctx.stroke();
          break;

        case 'text': {
          var fontSize = item.h;
          if (fontSize * cam.zoom < 1.5) break;
          ctx.save();
          ctx.translate(item.x, item.y);
          ctx.scale(1, -1);
          if (item.rot) ctx.rotate(-item.rot);
          ctx.font = fontSize + 'px Arial, sans-serif';
          ctx.fillText(item.text, 0, 0);
          ctx.restore();
          break;
        }

        case 'point': {
          var sz = 3 / cam.zoom;
          ctx.fillRect(item.x - sz / 2, item.y - sz / 2, sz, sz);
          break;
        }

        case 'hatchfill': {
          ctx.save();
          ctx.globalAlpha = 0.25;
          ctx.beginPath();
          for (var pi = 0; pi < item.paths.length; pi++) {
            var path = item.paths[pi];
            if (path.length < 2) continue;
            ctx.moveTo(path[0].x, path[0].y);
            for (var vi = 1; vi < path.length; vi++) {
              var v = path[vi];
              var prev = path[vi - 1];
              if (prev.bulge && prev.bulge !== 0) {
                drawBulgeArc(ctx, prev.x, prev.y, v.x, v.y, prev.bulge);
              } else {
                ctx.lineTo(v.x, v.y);
              }
            }
            var last = path[path.length - 1];
            var first = path[0];
            if (last.bulge && last.bulge !== 0) {
              drawBulgeArc(ctx, last.x, last.y, first.x, first.y, last.bulge);
            } else {
              ctx.lineTo(first.x, first.y);
            }
            ctx.closePath();
          }
          ctx.fill();
          ctx.restore();
          break;
        }

        case 'solid': {
          ctx.beginPath();
          ctx.moveTo(item.pts[0].x, item.pts[0].y);
          for (var pi = 1; pi < item.pts.length; pi++) {
            ctx.lineTo(item.pts[pi].x, item.pts[pi].y);
          }
          ctx.closePath();
          ctx.fill();
          break;
        }
      }
    }

    ctx.restore();
  }

  // ──────────────────────────────────────────────
  // Info overlay
  // ──────────────────────────────────────────────
  function createInfoOverlay(container, entityCount, layerCount) {
    var overlay = document.createElement('div');
    overlay.className = 'dwg-viewer-info';
    overlay.style.cssText =
      'position:absolute;bottom:8px;left:8px;padding:4px 10px;' +
      'background:rgba(0,0,0,0.6);color:#aaa;font:11px/1.4 monospace;' +
      'border-radius:4px;pointer-events:none;z-index:2;user-select:none;';
    overlay.textContent = entityCount.toLocaleString() + ' entities | ' + layerCount + ' layers';
    container.appendChild(overlay);
    return overlay;
  }

  // ──────────────────────────────────────────────
  // Active instance tracking for cleanup
  // ──────────────────────────────────────────────
  var _activeCleanup = null;

  // ──────────────────────────────────────────────
  // Main render function
  // ──────────────────────────────────────────────
  async function render(arrayBuffer, container, fileName) {
    // Clean up any previous instance
    if (_activeCleanup) {
      _activeCleanup();
      _activeCleanup = null;
    }

    // Show loading message
    var loadingDiv = document.createElement('div');
    loadingDiv.style.cssText =
      'display:flex;align-items:center;justify-content:center;width:100%;height:100%;' +
      'color:#ccc;font:14px/1.4 sans-serif;background:#1a1a2e;';
    loadingDiv.textContent = 'Loading DWG viewer...';
    container.innerHTML = '';
    container.style.position = 'relative';
    container.appendChild(loadingDiv);

    try {
      // Determine file type
      var isDxf = false;
      if (fileName) {
        var ext = fileName.split('.').pop().toLowerCase();
        isDxf = (ext === 'dxf');
      }

      // Parse
      var db = await parseDwg(new Uint8Array(arrayBuffer), isDxf);

      // Prepare drawing data
      var drawingData = prepareDrawingData(db);
      var bounds = drawingData.bounds;

      // Remove loading message, create canvas
      container.innerHTML = '';
      var canvas = document.createElement('canvas');
      canvas.style.cssText = 'display:block;width:100%;height:100%;';
      container.appendChild(canvas);

      // Info overlay
      var infoOverlay = createInfoOverlay(container, drawingData.renderList.length, drawingData.layerCount);

      // Camera
      var cam = { x: 0, y: 0, zoom: 1 };
      var dpr = window.devicePixelRatio || 1;

      function sizeCanvas() {
        var rect = container.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }

      function zoomExtents() {
        var rect = container.getBoundingClientRect();
        var w = rect.width;
        var h = rect.height;
        cam.x = (bounds.minX + bounds.maxX) / 2;
        cam.y = (bounds.minY + bounds.maxY) / 2;
        var bw = bounds.maxX - bounds.minX;
        var bh = bounds.maxY - bounds.minY;
        if (bw < 1) bw = 1;
        if (bh < 1) bh = 1;
        cam.zoom = Math.min(w / bw, h / bh) * 0.92;
      }

      function draw() {
        renderCanvas(canvas, drawingData, cam);
      }

      sizeCanvas();
      zoomExtents();
      draw();

      // ── Event handlers ──
      var dragging = false;
      var lastMx = 0, lastMy = 0;

      function onWheel(evt) {
        evt.preventDefault();
        var rect = canvas.getBoundingClientRect();
        var mx = evt.clientX - rect.left;
        var my = evt.clientY - rect.top;
        var w = rect.width, h = rect.height;

        // Screen coords relative to center
        var sx = mx - w / 2;
        var sy = my - h / 2;

        // World position under cursor before zoom
        var wx = cam.x + sx / cam.zoom;
        var wy = cam.y - sy / cam.zoom; // Y-flipped

        var factor = evt.deltaY < 0 ? 1.18 : 0.85;
        cam.zoom *= factor;

        // Adjust camera so world point stays under cursor
        cam.x = wx - sx / cam.zoom;
        cam.y = wy + sy / cam.zoom;

        draw();
      }

      function onMouseDown(evt) {
        if (evt.button !== 0) return;
        dragging = true;
        lastMx = evt.clientX;
        lastMy = evt.clientY;
        canvas.style.cursor = 'grabbing';
      }

      function onMouseMove(evt) {
        if (!dragging) return;
        var dx = evt.clientX - lastMx;
        var dy = evt.clientY - lastMy;
        lastMx = evt.clientX;
        lastMy = evt.clientY;
        cam.x -= dx / cam.zoom;
        cam.y += dy / cam.zoom; // Y-flipped
        draw();
      }

      function onMouseUp() {
        dragging = false;
        canvas.style.cursor = 'default';
      }

      function onDblClick() {
        zoomExtents();
        draw();
      }

      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      canvas.addEventListener('dblclick', onDblClick);

      // ResizeObserver
      var resizeObs = null;
      if (typeof ResizeObserver !== 'undefined') {
        resizeObs = new ResizeObserver(function () {
          sizeCanvas();
          draw();
        });
        resizeObs.observe(container);
      }

      // Cleanup function
      function cleanupInstance() {
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        canvas.removeEventListener('dblclick', onDblClick);
        if (resizeObs) {
          resizeObs.disconnect();
          resizeObs = null;
        }
        container.innerHTML = '';
        if (_activeCleanup === cleanupInstance) _activeCleanup = null;
      }

      _activeCleanup = cleanupInstance;
      return cleanupInstance;

    } catch (err) {
      container.innerHTML = '';
      var errDiv = document.createElement('div');
      errDiv.style.cssText =
        'display:flex;align-items:center;justify-content:center;width:100%;height:100%;' +
        'color:#ff6b6b;font:14px/1.4 sans-serif;background:#1a1a2e;padding:20px;text-align:center;';
      errDiv.textContent = 'Failed to load DWG file: ' + (err.message || err);
      container.appendChild(errDiv);
      throw err;
    }
  }

  // ──────────────────────────────────────────────
  // Public cleanup (for external callers)
  // ──────────────────────────────────────────────
  function cleanup() {
    if (_activeCleanup) {
      _activeCleanup();
      _activeCleanup = null;
    }
  }

  return {
    render: render,
    cleanup: cleanup
  };
})();
