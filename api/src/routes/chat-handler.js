// Vercel serverless handler for /api/chat
const chatRouter = require('./chat')
const express = require('express')
const app = express()
app.use(express.json())
app.use('/', chatRouter)
module.exports = app
