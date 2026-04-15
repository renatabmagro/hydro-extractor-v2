const ee = require('@google/earthengine');

const credentials = require('./gee-key.json');

ee.data.authenticateViaPrivateKey(
  credentials,
  () => {
    ee.initialize(
      null,
      null,
      () => {
        console.log("GEE Authenticated Successfully");
        
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
          
          geometry.evaluate((geom, err) => {
            if (err) console.error("Error evaluating geometry:", err);
            else console.log("Evaluated geometry:", geom);
          });
        } catch (e) {
          console.error('Error:', e);
        }
      },
      (e) => console.error("Initialization error: " + e)
    );
  },
  (e) => console.error("Authentication error: " + e)
);
