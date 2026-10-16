// Adapted from the read-only fingerprint reference. Optional main-world patches; not complete hardware emulation.
(function () {
  if (window.__arenaFingerprintV3Applied) return;
  window.__arenaFingerprintV3Applied = true;

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
      var getter = markNative(function () {
        // Preserve native receiver validation (e.g. Screen getter on {}).
        if (old && old.get) apply(old.get, this, []);
        return value;
      }, old && old.get);
      Object.defineProperty(obj, key, {
        get: getter, configurable: true, enumerable: old ? old.enumerable : false,
      });
    } catch (e) {}
  };

  var value = function (obj, key, val) {
    try { define(obj, key, val); } catch (e) {}
  };

  // Language, timezone, UA, CPU and DPR belong exclusively to native CDP overrides.
  if (fp.Hardware) {
    define(Navigator.prototype,'deviceMemory',fp.DeviceMemory);
    define(Navigator.prototype,'maxTouchPoints',fp.MaxTouchPoints);
    define(Screen.prototype,'width',fp.ScreenWidth);
    define(Screen.prototype,'height',fp.ScreenHeight);
    define(Screen.prototype,'availWidth',fp.ScreenWidth);
    define(Screen.prototype,'availHeight',fp.AvailableScreenHeight);
    define(Screen.prototype,'colorDepth',fp.ColorDepth);
    define(Screen.prototype,'pixelDepth',fp.ColorDepth);
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
      data[p] = (data[p] + delta) & 255;
    }
    return data;
  };

  if (fp.Canvas) try {
    var originalImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = markNative(function () {
      var result = originalImageData.apply(this, arguments);
      if (result && result.data) noisePixels(result.data, fp.CanvasSeed);
      return result;
    }, originalImageData);

    var cloneWithNoise = function (self) {
      var copy = document.createElement('canvas');
      copy.width = self.width;
      copy.height = self.height;
      var ctx = copy.getContext('2d');
      ctx.drawImage(self, 0, 0);
      var image = originalImageData.call(ctx, 0, 0, copy.width, copy.height);
      noisePixels(image.data, fp.CanvasSeed);
      ctx.putImageData(image, 0, 0);
      return copy;
    };

    var originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = markNative(function () {
      try { return originalToDataURL.apply(cloneWithNoise(this), arguments); }
      catch (e) { return originalToDataURL.apply(this, arguments); }
    }, originalToDataURL);

    var originalToBlob = HTMLCanvasElement.prototype.toBlob;
    if (originalToBlob) {
      HTMLCanvasElement.prototype.toBlob = markNative(function (callback) {
        try {
          var args = Array.prototype.slice.call(arguments, 1);
          return originalToBlob.call(cloneWithNoise(this), callback, ...args);
        } catch (e) { return originalToBlob.apply(this, arguments); }
      }, originalToBlob);
    }
  } catch (e) {}

  /* ---------------- WebGL vendor / renderer ----------------
   * 37445 = UNMASKED_VENDOR_WEBGL, 37446 = UNMASKED_RENDERER_WEBGL。
   * 这两个常量即使不取 debug_renderer_info 扩展也会被直接查询，
   * 所以必须在 getParameter 入口拦截，不能只改扩展返回。      */
  var patchWebGl = function (Type) {
    try {
      if (!Type) return;
      var original = Type.prototype.getParameter;
      Type.prototype.getParameter = markNative(function (parameter) {
        if (parameter === 37445 && fp.WebGlVendor) return fp.WebGlVendor;
        if (parameter === 37446 && fp.WebGlRenderer) return fp.WebGlRenderer;
        return original.apply(this, arguments);
      }, original);
    } catch (e) {}
  };
  if (fp.WebGL) {patchWebGl(window.WebGLRenderingContext);patchWebGl(window.WebGL2RenderingContext);}

  /* ---------------- Audio 指纹 ----------------
   * 单点微扰 1e-8 量级：足以改变浮点摘要，不足以让听感或波形分析察觉。 */
  if (fp.Audio) try {
    if (window.AudioBuffer && AudioBuffer.prototype.getChannelData) {
      var originalAudio = AudioBuffer.prototype.getChannelData;
      var touched = new WeakMap();
      AudioBuffer.prototype.getChannelData = markNative(function () {
        var data = originalAudio.apply(this, arguments);
        var channels=touched.get(this);if(!channels){channels=new Set();touched.set(this,channels);}
        if (data && !channels.has(Number(arguments[0])) && data.length) {
          channels.add(Number(arguments[0]));
          var index = Math.abs(fp.AudioSeed) % data.length;
          data[index] = data[index] + (((Math.abs(fp.AudioSeed) % 11) + 1) * 1e-8);
        }
        return data;
      }, originalAudio);
    }
  } catch (e) {}

  /* ---------------- 元素盒模型微扰 ----------------
   * 亚像素级偏移，破坏 getBoundingClientRect 的精确指纹，
   * 又不至于影响布局判定（各站点阈值通常远大于 1e-5）。 */
  var rectNoise = ((Math.abs(fp.ClientRectsSeed) % 9) + 1) * 0.00001;
  var cloneRect = function (r) {
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
    if (window.Range && Range.prototype.getBoundingClientRect) {
      var originalRangeRect = Range.prototype.getBoundingClientRect;
      Range.prototype.getBoundingClientRect = markNative(function () {
        return cloneRect(originalRangeRect.apply(this, arguments));
      }, originalRangeRect);
    }
  } catch (e) {}


})();
