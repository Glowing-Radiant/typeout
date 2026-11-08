// Apply saved display settings before first paint so the page never flashes the wrong theme.
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('typeout:settings:v1') || '{}');
    var r = document.documentElement;
    if (s.theme && s.theme !== 'system') r.dataset.theme = s.theme;
    if (s.reduceMotion) r.dataset.reduceMotion = 'true';
  } catch (e) {}
})();
