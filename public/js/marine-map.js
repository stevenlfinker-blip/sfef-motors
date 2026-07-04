// Shared Leaflet helpers for the Marine section (vessels + marinas maps).
const MarineMap = (() => {
  function create(elId, opts = {}) {
    const map = L.map(elId).setView(opts.center || [30, -80], opts.zoom || 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    return map;
  }

  function fitToPoints(map, points) {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0], 12);
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [30, 30] });
    }
  }

  return { create, fitToPoints };
})();
