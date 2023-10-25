const express = require('express')
const bent = require('bent')
const { createClient } = require('redis')

const app = express()
const getJSON = bent('json')
const redisClient = createClient()
redisClient.on('error', err => console.log('Redis redisClient Error', err))
redisClient.connect()

const PORT = 5001
const url = 'https://hacker-news.firebaseio.com/v0/topstories.json?print=pretty'
const IPKEY = 'IP:'
const USERKEY = 'USER:'

app.get('/data', rateLimiting, async (req, res) => {
    try {
        const data = await getJSON(url)
        const userId = Number(req.query.user)
        const result = data.filter(ele => ele % userId === 0)
        res.send({result});
    } catch (error) {
        console.error(error)
        res.statusCode = 500
        res.end('something went wrong')
    }
})

async function rateLimiting (req, res, next) {
    const ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''
    const userId = Number(req.query.user)
    const ipKey = `${IPKEY}${ip}`
    const userKey = `${USERKEY}${userId}`
    const ipCount = await redisClient.get(ipKey)
    const idCount = await redisClient.get(userKey)
    if (ipCount > 10 || idCount > 5) {
        res.statusCode = 429
        res.send({ip: ipCount, id: idCount});
        next(new Error('exceed limit times'))
    } else {
        await redisClient.expire(ipKey, 60)
        await redisClient.expire(userKey, 60)
    }
    await redisClient.incr(ipKey)
    await redisClient.incr(userKey)
    next()
}

app.listen(PORT, () => console.log(`Listening on ${PORT}`))
