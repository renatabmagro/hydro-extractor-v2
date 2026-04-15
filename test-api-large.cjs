const http = require('http');

const data = JSON.stringify({
  geoJson: {
    "type": "Polygon",
    "coordinates": [
      [
        [-70.0, -10.0],
        [-70.0, 5.0],
        [-50.0, 5.0],
        [-50.0, -10.0],
        [-70.0, -10.0]
      ]
    ]
  },
  startDate: '2018-01-01',
  endDate: '2018-03-31'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/timeseries',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => {
    body += chunk;
  });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Body:', body);
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write(data);
req.end();
