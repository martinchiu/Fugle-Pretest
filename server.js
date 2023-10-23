const express = require('express')
const bent = require('bent')

const app = express()
const getJSON = bent('json')

const PORT = 5001
const url = 'https://hacker-news.firebaseio.com/v0/topstories.json?print=pretty'

app.get('/data', async (req, res) => {
    try {
        const data = await getJSON(url)
        const userId = Number(req.query.user)
        const results = data.filter(ele => ele % userId === 0)
        res.send(JSON.stringify({results}));
    } catch (error) {
        console.error(error)
        res.statusCode = 500
        res.end('something went wrong')
    }
})


app.listen(PORT, () => console.log(`Listening on ${PORT}`))
