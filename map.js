import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Mapbox public token
mapboxgl.accessToken =
  'pk.eyJ1IjoibmFzaGt0b3JhYiIsImEiOiJjbXdlYzZ1OHowY3dtMnlweG9xcmh5ZjA1In0.vsw5Hay99OXhnWWmgRMiJg';

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

// Time controls
const slider = document.querySelector('#time-slider');
const selectedTime = document.querySelector('#selected-time');
const anyTime = document.querySelector('#any-time');

slider.disabled = true;

// Add a bike route layer
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

// Initialize after map loads
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

// Read the Boston clock time without timezone conversion
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

// Increment a station count
function increment(counts, id) {
  if (!id) {
    return;
  }

  counts.set(id, (counts.get(id) ?? 0) + 1);
}

async function loadStationsAndTrips() {
  try {
    console.log('Loading stations and trips...');

    const [json, trips] = await Promise.all([
      d3.json(
        'https://dsc106.com/labs/lab07/data/bluebikes-stations.json'
      ),
      d3.csv(
        'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv'
      ),
    ]);

    const stations = json.data.stations
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

    // Index events by minute for responsive filtering
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

    // Circle area represents total traffic
    const maxTraffic = d3.max(
      stations,
      (station) =>
        (allDepartures.get(station.short_name) ?? 0) +
        (allArrivals.get(station.short_name) ?? 0)
    );

    const radiusScale = d3
      .scaleSqrt()
      .domain([0, maxTraffic || 1])
      .range([0, 25]);

    // SVG station overlay
    const svg = d3
      .select(map.getCanvasContainer())
      .append('svg')
      .attr('class', 'station-overlay');

    const circles = svg
      .selectAll('circle')
      .data(stations, (d) => d.station_id)
      .join('circle')
      .attr('fill-opacity', 0.75)
      .attr('stroke', 'white')
      .attr('stroke-width', 1);

    circles.append('title');

    // Keep circles aligned with geographic locations
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

    // Update traffic using the selected time
    function updateTraffic() {
      const minute = Number(slider.value);

      let departures = allDepartures;
      let arrivals = allArrivals;

      selectedTime.hidden = minute === -1;
      anyTime.hidden = minute !== -1;

      if (minute !== -1) {
        const hours = String(
          Math.floor(minute / 60)
        ).padStart(2, '0');

        const minutes = String(
          minute % 60
        ).padStart(2, '0');

        selectedTime.dateTime = `${hours}:${minutes}`;
        selectedTime.textContent =
          `${hours}:${minutes} (Boston time, ±60 min)`;

        departures = new Map();
        arrivals = new Map();

        // Two-hour window, wrapping around midnight
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

      circles
        .attr('r', (d) => radiusScale(d.totalTraffic))
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

      // Update station tooltips
      circles
        .select('title')
        .text(
          (d) =>
            `${d.name}\n` +
            `${d.totalTraffic.toLocaleString()} total arrivals and departures\n` +
            `${d.departures.toLocaleString()} departures\n` +
            `${d.arrivals.toLocaleString()} arrivals`
        );
    }

    updatePositions();
    updateTraffic();

    map.on('move', updatePositions);
    map.on('resize', updatePositions);

    slider.disabled = false;
    slider.addEventListener('input', updateTraffic);

    console.log(`Loaded ${trips.length} trips.`);
    console.log(`Displayed ${stations.length} stations.`);
  } catch (error) {
    console.error('Could not load bike data:', error);
  }
}

map.on('error', (event) => {
  console.error('Map error:', event.error);
});