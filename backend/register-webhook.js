require('dotenv').config()

const token = process.env.ASANA_TOKEN

fetch('https://app.asana.com/api/1.0/webhooks', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    data: {
      resource: '1215200946967290',
      target: 'https://rockband-cycling-ploy.ngrok-free.dev/webhook'
    }
  })
})
.then(r => r.json())
.then(r => console.log(JSON.stringify(r, null, 2)))
.catch(e => console.error(e))