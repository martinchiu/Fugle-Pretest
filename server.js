const express = require('express')
const bent = require('bent')
const { createClient } = require('redis')
const WebSocket = require('ws');
const dayjs = require('dayjs')

const app = express()
const getJSON = bent('json')
const SocketServer = WebSocket.Server
const redisClient = createClient()
redisClient.on('error', err => console.log('Redis redisClient Error', err))
redisClient.connect()

const PORT = 5001
const url = 'https://hacker-news.firebaseio.com/v0/topstories.json?print=pretty'
const wsUrl = 'wss://ws.bitstamp.net'
const IPKEY = 'IP:'
const USERKEY = 'USER:'
const BITSKEY = 'BITS:'
const currencyPairArr = ['btcusd', 'btceur', 'btcgbp', 'btcpax', 'gbpusd', 'eurusd', 'xrpusd', 'xrpeur', 'ltcbtc', 'ltcusd']
let subscriptionList = []

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
    await redisClient.incr(ipKey)
    await redisClient.incr(userKey)
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
    next()
}

async function setRedis (currencyPair, liveTicker, timestamp) {
    const time = dayjs.unix(timestamp).format('YYYY-MM-DD HH:mm')
    const redisData = await redisClient.HGET(`${BITSKEY}${currencyPair}`, time)
    let dataObj
    if (redisData) {
        dataObj = JSON.parse(redisData)
        dataObj.low = dataObj.low > liveTicker ? liveTicker : dataObj.low
        dataObj.high = dataObj.high < liveTicker ? liveTicker : dataObj.high
        dataObj.close = dataObj.liveTicker = liveTicker
        await redisClient.HSET(`${BITSKEY}${currencyPair}`, time, JSON.stringify(dataObj))
    } else {
        dataObj = {}
        dataObj.open = dataObj.high = dataObj.low = dataObj.close = dataObj.liveTicker = liveTicker
        await redisClient.HSET(`${BITSKEY}${currencyPair}`, time, JSON.stringify(dataObj))
        await redisClient.EXPIRE(`${BITSKEY}${currencyPair}`, 900)
    }
    return dataObj 
}

const server = app.listen(PORT, () => console.log(`Listening on ${PORT}`))

// get bitstamp data
let wsClient = new WebSocket(wsUrl)
wsClient.onopen = () => {
    const WebSocketParam = {
        event: 'bts:subscribe',
        data: {}
    }
    currencyPairArr.forEach(ele => {
        WebSocketParam.data.channel = `live_trades_${ele}`
        wsClient.send(JSON.stringify(WebSocketParam))
    })
}
wsClient.onmessage = async event => {
    const result = JSON.parse(event.data)
    const currencyPair = result.channel.replace('live_trades_', '')
    if (Object.keys(result.data).length !== 0) {
        const redisData = await setRedis(currencyPair, result.data.price, result.data.timestamp)
        const responseObj = {}
        responseObj[currencyPair] = redisData
        subscriptionList.forEach((client) => {
            client.send(JSON.stringify(responseObj))
        })
    }
}

// WebSocket server
const wss = new SocketServer({ server })
wss.on('connection', ws => {
    console.log('Client connected')
    ws.on('message', async data => {
        data = JSON.parse(data.toString() ) 
        if (data.action === 'subscribe') {
            subscriptionList.push(ws)
        } else if (data.action === 'unsubscribe') {
            const index = subscriptionList.indexOf(ws)
            if (index !== -1) subscriptionList.splice(index, 1)
        }
    })

    ws.on('close', () => {
        console.log('Close connected')
    })
})
