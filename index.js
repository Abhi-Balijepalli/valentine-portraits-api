// Load environment variables FIRST (before any other imports)
import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Import routes after dotenv is configured
import generateRouter from './routes/generate.js'
import paymentRouter from './routes/payment.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3001

// Log environment status
console.log('Environment loaded:')
console.log('  - GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? 'SET' : 'NOT SET')
console.log('  - STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? 'SET' : 'NOT SET')
console.log('  - SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'NOT SET')

// Middleware
app.use(cors())
app.use(express.json())

// Serve uploaded/generated images
app.use('/uploads', express.static(join(__dirname, 'uploads')))

// API Routes
app.use('/api', generateRouter)
app.use('/api', paymentRouter)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
