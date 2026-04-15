const ee = require('@google/earthengine');

const geoJson = {
  "type": "Polygon",
  "coordinates": [
    [
      [-60.02, -3.16],
      [-60.02, -3.0],
      [-60.0, -3.0],
      [-60.0, -3.16],
      [-60.02, -3.16]
    ]
  ]
};

try {
  const feature = ee.Feature(geoJson.features ? geoJson.features[0] : geoJson);
  const geometry = feature.geometry();
  console.log('Geometry:', geometry);
} catch (e) {
  console.error('Error:', e);
}
