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
  var sources = new WeakMap();
  var markNative = function (replacement, original) {
    if (typeof original !== 'function') return replacement;
    var wrapped = new Proxy(original, {
      apply: function (_target, receiver, args) { return apply(replacement, receiver, args); },
    });
    sources.set(wrapped, apply(nativeToString, original, []));
    return wrapped;
  };
  var toString = new Proxy(nativeToString, {
    apply: function (target, receiver, args) {
      if (sources.has(receiver)) return sources.get(receiver);
      return apply(target, receiver, args);
    },
  });
  sources.set(toString, apply(nativeToString, nativeToString, []));
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
  }
  /* ---------------- Canvas 噪声 ----------------
   * 种子决定步长与增量，同一实例跨会话恒定。
   * 注意 toDataURL / toBlob 走「离屏副本」路径：必须先克隆再写噪点，
   * 否则会把噪点写回用户可见的画布，页面自己看得出来。            */
  var noisePixels = function (data, seed) {
    if (!data || data.length < 4) return data;
    var step = Math.max(4, Math.floor(data.length / 32 / 4) * 4);
    var delta = (Math.abs(seed) % 3) + 1;
    var start = Math.abs(seed) % Math.max(1, Math.min(step, data.length - 3));
    for (var i = start; i < data.length; i += step) {
      var p = i - (i % 4);
      // Transparent/empty pixels must stay transparent black. Saturate instead
      // of wrapping 255 to 0, which creates a visible discontinuity.
      if (data[p + 3] !== 0) data[p] += data[p] > 255 - delta ? -delta : delta;
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
    patchImageData(root.CanvasRenderingContext2D);
    patchImageData(root.OffscreenCanvasRenderingContext2D);

    var cloneWithNoise = function (self, offscreen) {
      // Native getters validate the receiver without invoking page-defined own
      // width/height getters on an invalid receiver or a genuine canvas.
      var width = apply(offscreen ? offscreenWidth : canvasWidth, self, []);
      var height = apply(offscreen ? offscreenHeight : canvasHeight, self, []);
      var copy = offscreen ? new OffscreenCanvas(width, height) : document.createElement('canvas');
      copy.width = width;
      copy.height = height;
      var ctx = copy.getContext('2d');
      ctx.drawImage(self, 0, 0);
      var image = apply(offscreen ? originalOffscreenImageData : originalImageData, ctx, [0, 0, copy.width, copy.height]);
      noisePixels(image.data, fp.CanvasSeed);
      ctx.putImageData(image, 0, 0);
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
    // Keep OffscreenCanvas.convertToBlob native: exporting a clone bypasses
    // its ownership checks and can change snapshot/encoder-option semantics.
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
          args = Array.prototype.slice.call(arguments);
          args[0] = { [Symbol.toPrimitive]: function () {
            var number = +parameter; converted = number >>> 0; return number;
          } };
        }
        var result = apply(original, this, args);
        if (result === null) return result;
        var enumValue = converted === undefined ? Number(parameter) >>> 0 : converted;
        if (enumValue === 37445 && fp.WebGlVendor) return fp.WebGlVendor;
        if (enumValue === 37446 && fp.WebGlRenderer) return fp.WebGlRenderer;
        return result;
      }, original);
    } catch (e) {}
  };
  if (fp.WebGL) {patchWebGl(root.WebGLRenderingContext);patchWebGl(root.WebGL2RenderingContext);}

  /* ---------------- Audio 指纹 ----------------
   * 只处理离线渲染产物；读取用户 AudioBuffer 不得修改其底层数据，
   * getChannelData 与 copyFromChannel 保留原生引用、写回和错误语义。 */
  if (fp.Audio) try {
    if (root.OfflineAudioContext && root.AudioBuffer) {
      var originalAudio = AudioBuffer.prototype.getChannelData;
      var rendered = new WeakSet();
      var noiseAudio = function (buffer) {
        if (!buffer || rendered.has(buffer)) return buffer;
        rendered.add(buffer);
        for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
          var data = apply(originalAudio, buffer, [channel]);
          // Do not create a signal in silence or change manually written buffers.
          for (var i = Math.abs(fp.AudioSeed) % 97; i < data.length; i += 97) {
            if (data[i] !== 0) {
              data[i] += (((Math.abs(fp.AudioSeed) % 11) + 1) * 1e-8);
              break;
            }
          }
        }
        return buffer;
      };
      var OriginalOffline = root.OfflineAudioContext;
      var originalRendering = OriginalOffline.prototype.startRendering;
      var addListener = EventTarget.prototype.addEventListener;
      var then = Promise.prototype.then;
      var WrappedOffline = new Proxy(OriginalOffline, { construct: function (target, args, newTarget) {
        var context = Reflect.construct(target, args, newTarget);
        // Register before the page's oncomplete/addEventListener callbacks.
        apply(addListener, context, ['complete', function (event) { noiseAudio(event.renderedBuffer); }, { once: true, capture: true }]);
        return context;
      } });
      sources.set(WrappedOffline, apply(nativeToString, OriginalOffline, []));
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
  var rectNoise = ((Math.abs(fp.ClientRectsSeed) % 9) + 1) * 0.00001;
  var cloneRect = function (r) {
    if (r.width === 0 && r.height === 0) return r;
    try { return new DOMRect(r.x + rectNoise, r.y + rectNoise, r.width, r.height); }
    catch (e) { return r; }
  };
  if (fp.Rects) try {
    var originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = markNative(function () {
      return cloneRect(originalRect.apply(this, arguments));
    }, originalRect);
  } catch (e) {}
  if (fp.Rects) try {
    if (root.Range && Range.prototype.getBoundingClientRect) {
      var originalRangeRect = Range.prototype.getBoundingClientRect;
      Range.prototype.getBoundingClientRect = markNative(function () {
        return cloneRect(originalRangeRect.apply(this, arguments));
      }, originalRangeRect);
    }
  } catch (e) {}


})();
