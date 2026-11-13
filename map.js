import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Mapbox public token
mapboxgl.accessToken =
  'pk.eyJ1IjoibmFzaGt0b3JhYiIsImEiOiJjbXdlYzZ1OHowY3dtMnlweG9xcmh5ZjA1In0.vsw5Hay99OXhnWWmgRMiJg';

// Page elements
const slider = document.querySelector('#time-slider');
const selectedTime = document.querySelector('#selected-time');
const resetButton = document.querySelector('#reset-time');
const status = document.querySelector('#status');
const tooltip = document.querySelector('#station-tooltip');

slider.disabled = true;
resetButton.disabled = true;

// Create map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
});

map.addControl(
  new mapboxgl.NavigationControl(),
  'top-right'
);

// Add bike route layers
function addBikeRoutes(id, url, filter) {
  map.addSource(id, {
    type: 'geojson',
    data: url,
  });

  const layer = {
    id: `${id}-layer`,
    type: 'line',
    source: id,

    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },

    paint: {
      'line-color': '#279447',
      'line-width': 3,
      'line-opacity': 0.65,
    },
  };

  if (filter) {
    layer.filter = filter;
  }

  map.addLayer(layer);
}

// Extract Boston clock time from the source timestamp
function minutesSinceMidnight(timestamp) {
  const match = String(timestamp).match(
    /[T ](\d{2}):(\d{2})/
  );

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function increment(counts, id) {
  if (!id) {
    return;
  }

  counts.set(id, (counts.get(id) ?? 0) + 1);
}

function formatTime(minute) {
  const hours = String(
    Math.floor(minute / 60)
  ).padStart(2, '0');

  const minutes = String(
    minute % 60
  ).padStart(2, '0');

  return `${hours}:${minutes}`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

function showTooltip(event, station) {
  tooltip.textContent =
    `${station.name}\n` +
    `Departures: ${station.departures.toLocaleString()}\n` +
    `Arrivals: ${station.arrivals.toLocaleString()}\n` +
    `Total: ${station.totalTraffic.toLocaleString()}`;

  tooltip.hidden = false;

  const box = tooltip.getBoundingClientRect();

  const left = Math.max(
    8,
    Math.min(
      event.clientX + 14,
      window.innerWidth - box.width - 8
    )
  );

  const top = Math.max(
    8,
    Math.min(
      event.clientY + 14,
      window.innerHeight - box.height - 8
    )
  );

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

// Load map layers and station data
map.on('load', async () => {
  addBikeRoutes(
    'boston-bike-routes',
    'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  );

  addBikeRoutes(
    'cambridge-bike-routes',
    'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
    [
      '>',
      ['coalesce', ['get', 'ExistingFacility'], 0],
      0,
    ]
  );

  await loadStationsAndTrips();
});

async function loadStationsAndTrips() {
  try {
    status.textContent =
      'Loading bike data… This may take a moment.';

    const [json, trips] = await Promise.all([
      d3.json(
        'https://dsc106.com/labs/lab07/data/bluebikes-stations.json'
      ),

      d3.csv(
        'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv'
      ),
    ]);

    const stations = json.data.stations
      .filter(
        (station) =>
          station.lat != null &&
          station.lon != null
      )
      .map((station) => ({
        ...station,
        lat: Number(station.lat),
        lon: Number(station.lon),
        departures: 0,
        arrivals: 0,
        totalTraffic: 0,
      }))
      .filter(
        (station) =>
          Number.isFinite(station.lat) &&
          Number.isFinite(station.lon)
      );

    // Pre-index events for fast slider updates
    const departuresByMinute = Array.from(
      { length: 1440 },
      () => []
    );

    const arrivalsByMinute = Array.from(
      { length: 1440 },
      () => []
    );

    const allDepartures = new Map();
    const allArrivals = new Map();

    for (const trip of trips) {
      increment(allDepartures, trip.start_station_id);
      increment(allArrivals, trip.end_station_id);

      const startMinute = minutesSinceMidnight(
        trip.started_at
      );

      const endMinute = minutesSinceMidnight(
        trip.ended_at
      );

      if (startMinute !== null) {
        departuresByMinute[startMinute].push(
          trip.start_station_id
        );
      }

      if (endMinute !== null) {
        arrivalsByMinute[endMinute].push(
          trip.end_station_id
        );
      }
    }

    // SVG overlay
    const svg = d3
      .select(map.getCanvasContainer())
      .append('svg')
      .attr('class', 'station-overlay');

    const circles = svg
      .selectAll('circle')
      .data(stations, (d) => d.station_id)
      .join('circle');

    // Instant hover and tap information
    circles
      .on('pointerenter', showTooltip)
      .on('pointermove', showTooltip)
      .on('pointerleave', hideTooltip)
      .on('click', (event, station) => {
        event.stopPropagation();
        showTooltip(event, station);
      });

    const radiusScale = d3
      .scaleSqrt()
      .range([0, 25]);

    function updatePositions() {
      circles.each(function (station) {
        const point = map.project([
          station.lon,
          station.lat,
        ]);

        d3.select(this)
          .attr('cx', point.x)
          .attr('cy', point.y);
      });
    }

    function updateTraffic() {
      hideTooltip();

      const minute = Number(slider.value);
      const showAll = minute === -1;

      let departures = allDepartures;
      let arrivals = allArrivals;

      selectedTime.textContent = showAll
        ? 'Any time'
        : `${formatTime(minute)} · Boston time`;

      slider.setAttribute(
        'aria-valuetext',
        showAll
          ? 'Any time'
          : `${formatTime(minute)}, Boston time`
      );

      if (!showAll) {
        departures = new Map();
        arrivals = new Map();

        // Include each minute within ±60 minutes.
        // Wrap around midnight.
        for (let offset = -60; offset <= 60; offset++) {
          const bucket =
            (minute + offset + 1440) % 1440;

          for (const id of departuresByMinute[bucket]) {
            increment(departures, id);
          }

          for (const id of arrivalsByMinute[bucket]) {
            increment(arrivals, id);
          }
        }
      }

      for (const station of stations) {
        station.departures =
          departures.get(station.short_name) ?? 0;

        station.arrivals =
          arrivals.get(station.short_name) ?? 0;

        station.totalTraffic =
          station.departures + station.arrivals;
      }

      // Rescale sizes for the current selection
      const currentMax =
        d3.max(stations, (d) => d.totalTraffic) || 1;

      radiusScale
        .domain([0, currentMax])
        .range([0, showAll ? 25 : 18]);

      circles
        .attr('r', (d) => radiusScale(d.totalTraffic))
        .attr(
          'display',
          (d) => d.totalTraffic > 0 ? null : 'none'
        )
        .style('--departure-ratio', (d) => {
          const ratio = d.totalTraffic
            ? d.departures / d.totalTraffic
            : 0.5;

          if (ratio < 0.4) {
            return 0;
          }

          if (ratio > 0.6) {
            return 1;
          }

          return 0.5;
        })
        .sort(
          (a, b) => b.totalTraffic - a.totalTraffic
        );

      const activeStations = stations.filter(
        (station) => station.totalTraffic > 0
      ).length;

      status.textContent = showAll
        ? `${activeStations} stations with recorded traffic · March 2024 · All times`
        : `${activeStations} stations with recorded traffic · Within 60 minutes of ${formatTime(minute)} across March 2024`;

      updatePositions();
    }

    // Update at most once per animation frame
    let pendingFrame = null;

    slider.addEventListener('input', () => {
      hideTooltip();

      if (pendingFrame !== null) {
        return;
      }

      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null;
        updateTraffic();
      });
    });

    resetButton.addEventListener('click', () => {
      slider.value = '-1';
      updateTraffic();
    });

    map.on('move', updatePositions);
    map.on('resize', updatePositions);
    map.on('movestart', hideTooltip);
    map.on('click', hideTooltip);

    window.addEventListener('scroll', hideTooltip, {
      passive: true,
    });

    window.addEventListener('resize', hideTooltip);

    updatePositions();
    updateTraffic();

    slider.disabled = false;
    resetButton.disabled = false;

    console.log(`Loaded ${trips.length} trips.`);
    console.log(`Loaded ${stations.length} stations.`);
  } catch (error) {
    console.error('Could not load bike data:', error);

    status.textContent =
      'Could not load bike data. Check the browser Console.';
  }
}

map.on('error', (event) => {
  console.error('Map error:', event.error);
});