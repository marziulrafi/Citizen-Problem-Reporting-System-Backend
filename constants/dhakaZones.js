/** Dhaka metropolitan zones — bounding boxes [minLat, maxLat, minLng, maxLng] */
const DHAKA_ZONES = [
  {
    id: "gulshan",
    name: "Gulshan-Banani",
    description: "Gulshan, Banani, Baridhara",
    bounds: { minLat: 23.77, maxLat: 23.82, minLng: 90.39, maxLng: 90.43 },
    center: { lat: 23.79, lng: 90.41 },
  },
  {
    id: "uttara",
    name: "Uttara",
    description: "Uttara sectors, Diabari",
    bounds: { minLat: 23.85, maxLat: 23.92, minLng: 90.37, maxLng: 90.42 },
    center: { lat: 23.875, lng: 90.39 },
  },
  {
    id: "mirpur",
    name: "Mirpur",
    description: "Mirpur, Pallabi, Kafrul",
    bounds: { minLat: 23.8, maxLat: 23.85, minLng: 90.34, maxLng: 90.39 },
    center: { lat: 23.822, lng: 90.365 },
  },
  {
    id: "dhanmondi",
    name: "Dhanmondi",
    description: "Dhanmondi, Zigatola",
    bounds: { minLat: 23.73, maxLat: 23.77, minLng: 90.36, maxLng: 90.39 },
    center: { lat: 23.75, lng: 90.375 },
  },
  {
    id: "mohammadpur",
    name: "Mohammadpur",
    description: "Mohammadpur, Adabor",
    bounds: { minLat: 23.74, maxLat: 23.78, minLng: 90.34, maxLng: 90.37 },
    center: { lat: 23.76, lng: 90.355 },
  },
  {
    id: "old_dhaka",
    name: "Old Dhaka",
    description: "Lalbagh, Chawkbazar, Kotwali",
    bounds: { minLat: 23.69, maxLat: 23.73, minLng: 90.38, maxLng: 90.41 },
    center: { lat: 23.71, lng: 90.395 },
  },
  {
    id: "motijheel",
    name: "Motijheel",
    description: "Motijheel, Paltan, Gulistan",
    bounds: { minLat: 23.72, maxLat: 23.75, minLng: 90.41, maxLng: 90.44 },
    center: { lat: 23.735, lng: 90.425 },
  },
  {
    id: "tejgaon",
    name: "Tejgaon",
    description: "Tejgaon, Farmgate, Kawran Bazar",
    bounds: { minLat: 23.76, maxLat: 23.79, minLng: 90.39, maxLng: 90.42 },
    center: { lat: 23.775, lng: 90.405 },
  },
  {
    id: "badda",
    name: "Badda",
    description: "Badda, Merul Badda, Shahjadpur",
    bounds: { minLat: 23.77, maxLat: 23.8, minLng: 90.42, maxLng: 90.45 },
    center: { lat: 23.785, lng: 90.435 },
  },
  {
    id: "rampura",
    name: "Rampura-Banasree",
    description: "Rampura, Banasree, Khilgaon",
    bounds: { minLat: 23.74, maxLat: 23.78, minLng: 90.42, maxLng: 90.46 },
    center: { lat: 23.76, lng: 90.44 },
  },
  {
    id: "jatrabari",
    name: "Jatrabari",
    description: "Jatrabari, Kadamtali, Demra approach",
    bounds: { minLat: 23.69, maxLat: 23.73, minLng: 90.42, maxLng: 90.46 },
    center: { lat: 23.71, lng: 90.44 },
  },
  {
    id: "cantonment",
    name: "Cantonment",
    description: "Dhaka Cantonment, Kafrul east",
    bounds: { minLat: 23.82, maxLat: 23.86, minLng: 90.38, maxLng: 90.42 },
    center: { lat: 23.84, lng: 90.4 },
  },
];

const DHAKA_CENTER = { lat: 23.8103, lng: 90.4125 };
const DHAKA_BOUNDS = { minLat: 23.68, maxLat: 23.93, minLng: 90.32, maxLng: 90.51 };

function isInsideBounds(lat, lng, bounds) {
  return lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng;
}

function distanceSq(lat1, lng1, lat2, lng2) {
  return (lat1 - lat2) ** 2 + (lng1 - lng2) ** 2;
}

function getZoneFromCoordinates(lat, lng) {
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;

  const match = DHAKA_ZONES.find((z) => isInsideBounds(latitude, longitude, z.bounds));
  if (match) return match;

  if (!isInsideBounds(latitude, longitude, DHAKA_BOUNDS)) return null;

  let nearest = DHAKA_ZONES[0];
  let minDist = Infinity;
  for (const z of DHAKA_ZONES) {
    const d = distanceSq(latitude, longitude, z.center.lat, z.center.lng);
    if (d < minDist) {
      minDist = d;
      nearest = z;
    }
  }
  return nearest;
}

function getZoneById(zoneId) {
  return DHAKA_ZONES.find((z) => z.id === zoneId) || null;
}

function getZoneLabel(zoneId) {
  return getZoneById(zoneId)?.name || zoneId || "Unknown";
}

module.exports = {
  DHAKA_ZONES,
  DHAKA_CENTER,
  DHAKA_BOUNDS,
  getZoneFromCoordinates,
  getZoneById,
  getZoneLabel,
  isInsideBounds,
};
