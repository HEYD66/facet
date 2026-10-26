// Adapted from the read-only fingerprint reference. Optional main-world patches; not complete hardware emulation.
(function () {
  var root = globalThis;
  var worker = typeof document === 'undefined';
  if (root.__arenaFingerprintV3Applied) return;
  Object.defineProperty(root, '__arenaFingerprintV3Applied', { value: true, configurable: true });

  var fp = /*__FACET_FP_PAYLOAD__*/null;
  if (!fp || typeof fp !== 'object') return;

  // Keep the original callable as the Proxy target: name/length, non-constructability
  // and property descriptors then retain their native shape. Only registered
  // replacements get an original source string; ordinary functions stay untouched.
  var nativeToString = Function.prototype.toString;
  var apply = Reflect.apply;
  // Browser APIs do not depend on helpers a site replaces after startup.
  // Retain those intrinsics for our own bookkeeping and conversions as well.
  var construct = Reflect.construct, reflectGet = Reflect.get;
  var mapHas = WeakMap.prototype.has, mapGet = WeakMap.prototype.get, mapSet = WeakMap.prototype.set;
  var setHas = WeakSet.prototype.has, setAdd = WeakSet.prototype.add;
  var slice = Array.prototype.slice, create = Object.create;
  var NativeProxy = Proxy, NativeString = String, NativeDOMRect = root.DOMRect, toPrimitive = Symbol.toPrimitive;
  var abs = Math.abs, floor = Math.floor, max = Math.max, min = Math.min;
  var sources = new WeakMap();
  var markNative = function (replacement, original) {
    if (typeof original !== 'function') return replacement;
    var wrapped = new NativeProxy(original, {
      apply: function (_target, receiver, args) { return apply(replacement, receiver, args); },
    });
    apply(mapSet, sources, [wrapped, apply(nativeToString, original, [])]);
    return wrapped;
  };
  var toString = new NativeProxy(nativeToString, {
    apply: function (target, receiver, args) {
      if (apply(mapHas, sources, [receiver])) return apply(mapGet, sources, [receiver]);
      return apply(target, receiver, args);
    },
  });
  apply(mapSet, sources, [toString, apply(nativeToString, nativeToString, [])]);
  Object.defineProperty(Function.prototype, 'toString', {
    ...Object.getOwnPropertyDescriptor(Function.prototype, 'toString'), value: toString,
  });
  var define = function (obj, key, value) {
    try {
      var old = Object.getOwnPropertyDescriptor(obj, key);
      if (!old || typeof old.get !== 'function' || !old.configurable) return;
      var getter = markNative(function () {
        // Preserve native receiver validation (e.g. Screen getter on {}).
        if (old && old.get) apply(old.get, this, []);
        return value;
      }, old && old.get);
      Object.defineProperty(obj, key, {
        ...old, get: getter,
      });
    } catch (e) {}
  };

  var value = function (obj, key, val) {
    try { define(obj, key, val); } catch (e) {}
  };

  // Native CDP covers document/worker locale, timezone and CPU. Existing worker
  // globals can retain UA fields created before CDP's override; fix only their
  // existing getters. Do not invent window-only APIs on WorkerNavigator.
  var navigatorType = worker ? root.WorkerNavigator : root.Navigator;
  if (worker && navigatorType) {
    if (fp.WorkerUserAgent) {
      define(navigatorType.prototype, 'userAgent', fp.WorkerUserAgent);
      define(navigatorType.prototype, 'appVersion', fp.WorkerUserAgent.replace(/^Mozilla\//, ''));
    }
    if (fp.WorkerPlatform) define(navigatorType.prototype, 'platform', fp.WorkerPlatform);
    if (fp.WorkerLanguage) {
      define(navigatorType.prototype, 'language', fp.WorkerLanguage);
      define(navigatorType.prototype, 'languages', Object.freeze([fp.WorkerLanguage]));
    }
    if (fp.WorkerCPU) define(navigatorType.prototype, 'hardwareConcurrency', fp.WorkerCPU);
  }
  if (fp.Hardware) {
    if (navigatorType) {
      define(navigatorType.prototype,'deviceMemory',fp.DeviceMemory);
      define(navigatorType.prototype,'maxTouchPoints',fp.MaxTouchPoints);
    }
    if (root.Screen) {
      define(Screen.prototype,'width',fp.ScreenWidth);
      define(Screen.prototype,'height',fp.ScreenHeight);
      define(Screen.prototype,'availWidth',fp.ScreenWidth);
      define(Screen.prototype,'availHeight',fp.AvailableScreenHeight);
      define(Screen.prototype,'colorDepth',fp.ColorDepth);
      define(Screen.prototype,'pixelDepth',fp.ColorDepth);
    }
    // window.outerWidth/outerHeight are the real Facet window. On a simulated screen smaller
    // than that window they exceeded screen.width/availHeight, which no real machine reports.
    // Clamp them to the available area (a maximized window); smaller windows stay native, so
    // they keep following resizes. The page view is sized to fit inside (viewport.cjs).
    if (!worker) {
      var clampWindow = function (key, limit) {
        try {
          var d = Object.getOwnPropertyDescriptor(root, key);
          if (!d || typeof d.get !== 'function' || !d.configurable || !(limit > 0)) return;
          var nativeGet = d.get;
          Object.defineProperty(root, key, { ...d, get: markNative(function () {
            var v = apply(nativeGet, this, []);
            return typeof v === 'number' && v > limit ? limit : v;
          }, nativeGet) });
        } catch (e) {}
      };
      clampWindow('outerWidth', fp.ScreenWidth);
      clampWindow('outerHeight', fp.AvailableScreenHeight);
    }
  }
  /* ---------------- devicePixelRatio 精度 ----------------
   * 模拟 DPR 在 Chromium 里按“原生缩放 × 模拟/原生”的 float32 计算，页面读到 1.0000000149011612、
   * 1.5000000596046448 之类的值；真实 Chrome 在 100% 缩放下报告精确值，并与 resolution 媒体查询一致。
   * 这里只把与配置值相差不到 1e-6 的舍入残差改回配置值；页面缩放等其他取值原样返回。
   * 跨站 iframe（独立进程）不接收模拟，仍是原生值，与它自己的 CSS 媒体查询一致，不在这里改。 */
  if (!worker && typeof fp.DevicePixelRatio === 'number' && fp.DevicePixelRatio > 0) try {
    var dprDescriptor = Object.getOwnPropertyDescriptor(root, 'devicePixelRatio');
    if (dprDescriptor && typeof dprDescriptor.get === 'function' && dprDescriptor.configurable) {
      var nativeDpr = dprDescriptor.get, wantedDpr = fp.DevicePixelRatio;
      Object.defineProperty(root, 'devicePixelRatio', {
        ...dprDescriptor,
        get: markNative(function () {
          var v = apply(nativeDpr, this, []);
          return typeof v === 'number' && abs(v - wantedDpr) < 1e-6 ? wantedDpr : v;
        }, nativeDpr),
      });
    }
  } catch (e) {}
  /* ---------------- window.chrome 外观 ----------------
   * 真实 Chrome 的 window.chrome 带 app / csi / loadTimes；Electron 只留一个空对象，
   * 是常见的自动化/非 Chrome 标志。这里在窗口上补齐这三项（Worker 没有 window.chrome 不处理），
   * 取值来自本页自己的 performance 计时，保持自洽。runtime 在普通网页本就缺省，不添加。 */
  if (!worker && root.chrome && typeof root.chrome === 'object') try {
    var chromeObj = root.chrome;
    var ownProp = Object.prototype.hasOwnProperty;
    var nativeFn = function (name, fn) { apply(mapSet, sources, [fn, 'function ' + name + '() { [native code] }']); return fn; };
    var addChrome = function (key, val) {
      if (apply(ownProp, chromeObj, [key])) return;
      try { Object.defineProperty(chromeObj, key, { value: val, writable: true, enumerable: true, configurable: true }); } catch (e) {}
    };
    var perf = root.performance;
    var navEntry = perf && perf.getEntriesByType ? perf.getEntriesByType('navigation')[0] : null;
    var originMs = perf && perf.timeOrigin ? perf.timeOrigin : Date.now();
    var secOf = function (ms) { return (originMs + (ms || 0)) / 1000; };
    addChrome('csi', nativeFn('csi', function csi() {
      return {
        startE: floor(originMs),
        onloadT: floor(originMs + (navEntry ? navEntry.domContentLoadedEventEnd : 0)),
        pageT: perf && perf.now ? perf.now() : 0,
        tran: 15,
      };
    }));
    addChrome('loadTimes', nativeFn('loadTimes', function loadTimes() {
      var d = navEntry || {};
      return {
        requestTime: secOf(d.requestStart || d.startTime || 0),
        startLoadTime: secOf(d.startTime || 0),
        commitLoadTime: secOf(d.responseStart || 0),
        finishDocumentLoadTime: secOf(d.domContentLoadedEventEnd || 0),
        finishLoadTime: secOf(d.loadEventEnd || 0),
        firstPaintTime: secOf((d.responseEnd || 0) + 1),
        firstPaintAfterLoadTime: 0,
        navigationType: 'Other',
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
        npnNegotiatedProtocol: 'h2',
        wasAlternateProtocolAvailable: false,
        connectionInfo: 'h2',
      };
    }));
    addChrome('app', {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: nativeFn('getDetails', function getDetails() { return null; }),
      getIsInstalled: nativeFn('getIsInstalled', function getIsInstalled() { return false; }),
      installState: nativeFn('installState', function installState() { return 'not_installed'; }),
      runningState: nativeFn('runningState', function runningState() { return 'cannot_run'; }),
    });
  } catch (e) {}

  /* ---------------- Canvas 噪声 ----------------
   * 种子决定步长与增量，同一实例跨会话恒定。
   * 注意 toDataURL / toBlob 走「离屏副本」路径：必须先克隆再写噪点，
   * 否则会把噪点写回用户可见的画布，页面自己看得出来。            */
  var noisePixels = function (data, seed) {
    if (!data || data.length < 4) return data;
    var step = max(4, floor(data.length / 32 / 4) * 4);
    var normalized = data.BYTES_PER_ELEMENT > 1;
    var limit = normalized ? 1 : 255;
    var delta = ((abs(seed) % 3) + 1) / (normalized ? 255 : 1);
    var start = abs(seed) % max(1, min(step, data.length - 3));
    for (var i = start; i < data.length; i += step) {
      var p = i - (i % 4);
      // Transparent/empty pixels must stay transparent black. Saturate instead
      // of wrapping 255 to 0, which creates a visible discontinuity.
      if (data[p + 3] !== 0 && data[p] >= 0 && data[p] <= limit) data[p] += data[p] > limit - delta ? -delta : delta;
    }
    return data;
  };

  if (fp.Canvas) try {
    var patchImageData = function (Type) {
      if (!Type) return;
      var original = Type.prototype.getImageData;
      if (!original) return;
      Type.prototype.getImageData = markNative(function () {
        var result = apply(original, this, arguments);
        if (result && result.data) noisePixels(result.data, fp.CanvasSeed);
        return result;
      }, original);
    };
    var originalImageData = root.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype.getImageData;
    var originalOffscreenImageData = root.OffscreenCanvasRenderingContext2D && OffscreenCanvasRenderingContext2D.prototype.getImageData;
    var canvasWidth = root.HTMLCanvasElement && Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width').get;
    var canvasHeight = root.HTMLCanvasElement && Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height').get;
    var offscreenWidth = root.OffscreenCanvas && Object.getOwnPropertyDescriptor(OffscreenCanvas.prototype, 'width').get;
    var offscreenHeight = root.OffscreenCanvas && Object.getOwnPropertyDescriptor(OffscreenCanvas.prototype, 'height').get;
    var NativeOffscreenCanvas = root.OffscreenCanvas;
    var offscreenContext = NativeOffscreenCanvas && NativeOffscreenCanvas.prototype.getContext;
    var offscreenDraw = root.OffscreenCanvasRenderingContext2D && OffscreenCanvasRenderingContext2D.prototype.drawImage;
    var offscreenPut = root.OffscreenCanvasRenderingContext2D && OffscreenCanvasRenderingContext2D.prototype.putImageData;
    var offscreenAttributes = root.OffscreenCanvasRenderingContext2D && OffscreenCanvasRenderingContext2D.prototype.getContextAttributes;
    var glColorSpace = root.WebGLRenderingContext && Object.getOwnPropertyDescriptor(WebGLRenderingContext.prototype, 'drawingBufferColorSpace');
    var gl2ColorSpace = root.WebGL2RenderingContext && Object.getOwnPropertyDescriptor(WebGL2RenderingContext.prototype, 'drawingBufferColorSpace');
    var offscreenContexts = new WeakMap();
    if (offscreenContext) NativeOffscreenCanvas.prototype.getContext = markNative(function () {
      var context = apply(offscreenContext, this, arguments);
      if (context) apply(mapSet, offscreenContexts, [this, context]);
      return context;
    }, offscreenContext);
    patchImageData(root.CanvasRenderingContext2D);
    patchImageData(root.OffscreenCanvasRenderingContext2D);

    var cloneWithNoise = function (self, offscreen) {
      // Native getters validate the receiver without invoking page-defined own
      // width/height getters on an invalid receiver or a genuine canvas.
      var width = apply(offscreen ? offscreenWidth : canvasWidth, self, []);
      var height = apply(offscreen ? offscreenHeight : canvasHeight, self, []);
      var attributes, source2D;
      if (offscreen) {
        // Do not call getContext on the SOURCE: a context-less canvas must stay
        // context-less, and an existing WebGL/bitmaprenderer must keep its mode.
        var originalContext = apply(mapGet, offscreenContexts, [self]);
        if (!originalContext) throw new Error('Canvas context not tracked');
        try { attributes = apply(offscreenAttributes, originalContext, []); source2D = originalContext; }
        catch (e) {
          var colorSpace;
          try { colorSpace = apply(glColorSpace.get, originalContext, []); }
          catch (e) { colorSpace = apply(gl2ColorSpace.get, originalContext, []); }
          attributes = { colorSpace: colorSpace };
        }
      }
      var copy = offscreen ? new NativeOffscreenCanvas(width, height) : document.createElement('canvas');
      if (!offscreen) { copy.width = width; copy.height = height; }
      var ctx = offscreen ? apply(offscreenContext, copy, ['2d', attributes]) : copy.getContext('2d');
      var imageArgs = [0, 0, width, height];
      if (offscreen) imageArgs.push({ colorSpace: attributes.colorSpace, pixelFormat: attributes.colorType === 'float16' ? 'rgba-float16' : 'rgba-unorm8' });
      // Direct native 2D readback preserves P3/float16 values; drawImage would
      // introduce a color-conversion round trip before applying the same noise.
      if (!source2D) { if (offscreen) apply(offscreenDraw, ctx, [self, 0, 0]); else ctx.drawImage(self, 0, 0); }
      var image = apply(offscreen ? originalOffscreenImageData : originalImageData, source2D || ctx, imageArgs);
      noisePixels(image.data, fp.CanvasSeed);
      if (offscreen) apply(offscreenPut, ctx, [image, 0, 0]); else ctx.putImageData(image, 0, 0);
      return copy;
    };
    var maybeClone = function (self, offscreen) {
      try { return cloneWithNoise(self, offscreen); } catch (e) { return self; }
    };

    if (root.HTMLCanvasElement) {
      var originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = markNative(function () {
        return apply(originalToDataURL, maybeClone(this, false), arguments);
      }, originalToDataURL);
      var originalToBlob = HTMLCanvasElement.prototype.toBlob;
      if (originalToBlob) {
        HTMLCanvasElement.prototype.toBlob = markNative(function () {
          return apply(originalToBlob, maybeClone(this, false), arguments);
        }, originalToBlob);
      }
    }
    if (root.OffscreenCanvas && OffscreenCanvas.prototype.convertToBlob) {
      var originalConvertToBlob = OffscreenCanvas.prototype.convertToBlob;
      var promiseThen = Promise.prototype.then;
      OffscreenCanvas.prototype.convertToBlob = markNative(function () {
        var options = arguments[0], args = arguments;
        var captured = { quality: undefined, type: undefined };
        var converted = options === null || options === undefined;
        if (options !== null && (typeof options === 'object' || typeof options === 'function')) {
          // Let native code choose when/which dictionary members to read. Record
          // their primitive values once, so encoding the snapshot cannot invoke
          // a website's getters/valueOf/toString a second time.
          // Use an empty facade target. Returning converted primitives from a
          // Proxy over the user's frozen object would violate Proxy invariants.
          args = [new NativeProxy(create(null), { get: function (_target, key) {
            var item = reflectGet(options, key, options);
            if (key === 'quality') {
              captured.quality = item === undefined ? undefined : +item;
              return captured.quality;
            }
            if (key === 'type') {
              // WebIDL rejects Symbol (String(Symbol) by itself would not).
              captured.type = item === undefined || typeof item === 'symbol' ? item : NativeString(item);
              converted = true;
              return captured.type;
            }
            return item;
          } })];
        }
        // Always validate the ORIGINAL canvas first. Its promise retains native
        // ownership, origin-clean, detached, empty-size and receiver errors.
        var result = apply(originalConvertToBlob, this, args);
        if (!converted) return result;
        var copy;
        try { copy = cloneWithNoise(this, true); } catch (e) { return result; }
        // Clone synchronously after native option conversion/snapshot, before
        // callers can clear, resize, transfer or paint the original canvas.
        // Native failure must never turn into successful clone export.
        return apply(promiseThen, result, [function () {
          return apply(originalConvertToBlob, copy, [captured]);
        }]);
      }, originalConvertToBlob);
    }
  } catch (e) {}

  /* ---------------- WebGL vendor / renderer ----------------
   * 37445 = UNMASKED_VENDOR_WEBGL, 37446 = UNMASKED_RENDERER_WEBGL。
   * 先调用原生方法，保留接收者校验、参数转换和扩展未启用时的
   * INVALID_ENUM / null。只替换原生已经允许读取的信息。       */
  var patchWebGl = function (Type) {
    try {
      if (!Type) return;
      var original = Type.prototype.getParameter;
      Type.prototype.getParameter = markNative(function (parameter) {
        var args = arguments, converted;
        // Let native WebIDL perform receiver validation before converting the
        // argument. Capture object coercion so user valueOf runs exactly once.
        if (parameter !== null && (typeof parameter === 'object' || typeof parameter === 'function')) {
          args = apply(slice, arguments, []);
          args[0] = { [toPrimitive]: function () {
            var number = +parameter; converted = number >>> 0; return number;
          } };
        }
        var result = apply(original, this, args);
        if (result === null) return result;
        var enumValue = converted === undefined ? +parameter >>> 0 : converted;
        if (enumValue === 37445 && fp.WebGlVendor) return fp.WebGlVendor;
        if (enumValue === 37446 && fp.WebGlRenderer) return fp.WebGlRenderer;
        return result;
      }, original);
    } catch (e) {}
  };
  if (fp.WebGL) {patchWebGl(root.WebGLRenderingContext);patchWebGl(root.WebGL2RenderingContext);}

  /* ---------------- WebGPU 适配器信息 ----------------
   * 与 WebGL 渲染器对应的 GPUAdapterInfo（adapter.info / device.adapterInfo 共用同一原型）：
   * vendor / architecture 换成模拟显卡的值，device、description 原生本就为空，不改。
   * 模拟的显卡没有 Direct3D 12（NVIDIA Fermi 及更早、AMD TeraScale、Intel Sandy/Ivy Bridge）时，
   * 真实 Chrome 拿不到适配器：requestAdapter() 先走原生（保留接收者和参数校验），结果改为 null。
   * limits、features 和子组大小仍是本机显卡的值。 */
  // In a Dedicated Worker paused at start (where this runs) navigator.gpu exists but the GPU and
  // GPUAdapterInfo globals are not installed yet (measured), so the prototypes are reached through
  // navigator.gpu and the first adapter instead.
  if (fp.WebGpu && typeof fp.WebGpu === 'object') try {
    var getProto = Object.getPrototypeOf, ownDescriptor = Object.getOwnPropertyDescriptor;
    var patchedInfo = new WeakSet();
    var patchInfo = function (proto) {
      if (!fp.WebGpu.Supported || !proto || apply(setHas, patchedInfo, [proto])) return;
      apply(setAdd, patchedInfo, [proto]);
      define(proto, 'vendor', NativeString(fp.WebGpu.Vendor || ''));
      define(proto, 'architecture', NativeString(fp.WebGpu.Architecture || ''));
    };
    if (root.GPUAdapterInfo) patchInfo(GPUAdapterInfo.prototype);
    var gpuObject = root.navigator && root.navigator.gpu;
    var gpuProto = root.GPU ? GPU.prototype : gpuObject ? getProto(gpuObject) : null;
    if (gpuProto && typeof gpuProto.requestAdapter === 'function') {
      var nativeRequestAdapter = gpuProto.requestAdapter, adapterThen = Promise.prototype.then;
      gpuProto.requestAdapter = markNative(function () {
        var pending = apply(nativeRequestAdapter, this, arguments);
        return apply(adapterThen, pending, [function (adapter) {
          if (!fp.WebGpu.Supported) return null;
          if (adapter) try {
            var infoDescriptor = ownDescriptor(getProto(adapter), 'info');
            var info = infoDescriptor && infoDescriptor.get ? apply(infoDescriptor.get, adapter, []) : null;
            if (info) patchInfo(getProto(info));
          } catch (e) {}
          return adapter;
        }]);
      }, nativeRequestAdapter);
    }
  } catch (e) {}

  /* ---------------- Audio 指纹 ----------------
   * 只处理离线渲染产物；读取用户 AudioBuffer 不得修改其底层数据，
   * getChannelData 与 copyFromChannel 保留原生引用、写回和错误语义。 */
  if (fp.Audio) try {
    if (root.OfflineAudioContext && root.AudioBuffer) {
      var originalAudio = AudioBuffer.prototype.getChannelData;
      var rendered = new WeakSet();
      // One fixed gain per seed on every rendered sample, 1e-6–1e-5 relative. A single nudged
      // sample (the old approach) never reached the window audio fingerprints sum (samples
      // 4500–5000), so every instance reported the same 124.04347… value. The gain moves that
      // sum from the 4th–5th decimal, is stable across renders, keeps silence at zero and is
      // far below audibility.
      var audioGain = 1 + ((abs(fp.AudioSeed) % 2 ? 1 : -1) * (1 + (abs(fp.AudioSeed) >>> 1) % 9000 / 1000) * 1e-6);
      var noiseAudio = function (buffer) {
        if (!buffer || apply(setHas, rendered, [buffer])) return buffer;
        apply(setAdd, rendered, [buffer]);
        for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
          var data = apply(originalAudio, buffer, [channel]);
          for (var i = 0; i < data.length; i++) if (data[i] !== 0) data[i] *= audioGain;
        }
        return buffer;
      };
      var OriginalOffline = root.OfflineAudioContext;
      var originalRendering = OriginalOffline.prototype.startRendering;
      var addListener = EventTarget.prototype.addEventListener;
      var then = Promise.prototype.then;
      var WrappedOffline = new NativeProxy(OriginalOffline, { construct: function (target, args, newTarget) {
        var context = construct(target, args, newTarget);
        // Register before the page's oncomplete/addEventListener callbacks.
        apply(addListener, context, ['complete', function (event) { noiseAudio(event.renderedBuffer); }, { once: true, capture: true }]);
        return context;
      } });
      apply(mapSet, sources, [WrappedOffline, apply(nativeToString, OriginalOffline, [])]);
      Object.defineProperty(root, 'OfflineAudioContext', { ...Object.getOwnPropertyDescriptor(root, 'OfflineAudioContext'), value: WrappedOffline });
      if (root.webkitOfflineAudioContext === OriginalOffline) Object.defineProperty(root, 'webkitOfflineAudioContext', { ...Object.getOwnPropertyDescriptor(root, 'webkitOfflineAudioContext'), value: WrappedOffline });
      Object.defineProperty(OriginalOffline.prototype, 'constructor', { ...Object.getOwnPropertyDescriptor(OriginalOffline.prototype, 'constructor'), value: WrappedOffline });
      OriginalOffline.prototype.startRendering = markNative(function () {
        // Invoke native first so bad receivers and repeated starts fail natively.
        var result = apply(originalRendering, this, arguments);
        return apply(then, result, [
          function (buffer) { noiseAudio(buffer); return buffer; },
        ]);
      }, originalRendering);
    }
  } catch (e) {}

  /* ---------------- 元素盒模型微扰 ----------------
   * 亚像素级偏移，破坏 getBoundingClientRect 的精确指纹，
   * 又不至于影响布局判定（各站点阈值通常远大于 1e-5）。 */
  var rectNoise = ((abs(fp.ClientRectsSeed) % 9) + 1) * 0.00001;
  var cloneRect = function (r) {
    if (r.width === 0 && r.height === 0) return r;
    try { return new NativeDOMRect(r.x + rectNoise, r.y + rectNoise, r.width, r.height); }
    catch (e) { return r; }
  };
  if (fp.Rects) try {
    var originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = markNative(function () {
      return cloneRect(apply(originalRect, this, arguments));
    }, originalRect);
  } catch (e) {}
  if (fp.Rects) try {
    if (root.Range && Range.prototype.getBoundingClientRect) {
      var originalRangeRect = Range.prototype.getBoundingClientRect;
      Range.prototype.getBoundingClientRect = markNative(function () {
        return cloneRect(apply(originalRangeRect, this, arguments));
      }, originalRangeRect);
    }
  } catch (e) {}


})();
