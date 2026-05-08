import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 4173)
const HOST = process.env.HOST || '127.0.0.1'
const DATA_DIR = path.join(__dirname, 'data')
const DB_PATH = path.join(DATA_DIR, 'db.json')
const SESSION_COOKIE = 'summon_admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'summon123'
const ADMIN_TOKEN = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex')

const defaultDb = {
  tickets: [
    {
      id: 'single',
      name: '单次入场',
      price: 10,
      enabled: true,
      requiresPaymentScreenshot: true,
      description: '含指定饮品一杯',
    },
    {
      id: 'student',
      name: '学生票',
      price: 5,
      enabled: true,
      requiresPaymentScreenshot: true,
      description: '凭有效学生证使用，不含饮品',
    },
    {
      id: 'tuesday-free',
      name: '每周二免费入场',
      price: 0,
      enabled: true,
      requiresPaymentScreenshot: false,
      description: '免费日仍需登记与签署安全须知',
    },
  ],
  visitors: [],
  waivers: [],
  orders: [],
  checkins: [],
  smsCodes: [],
}

const json = (res, status, payload, extraHeaders = {}) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  })
  res.end(JSON.stringify(payload))
}

const notFound = (res) => json(res, 404, { error: '接口不存在' })

const readBody = async (req) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('请求格式必须是 JSON')
  }
}

const ensureDb = async () => {
  await fs.mkdir(DATA_DIR, { recursive: true })
  try {
    await fs.access(DB_PATH)
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify(defaultDb, null, 2))
  }
}

const readDb = async () => {
  await ensureDb()
  const content = await fs.readFile(DB_PATH, 'utf8')
  const parsed = JSON.parse(content)
  return { ...defaultDb, ...parsed }
}

const writeDb = async (db) => {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2))
}

const normalizePhone = (phone = '') => String(phone).replace(/\D/g, '')
const isPhone = (phone) => /^1\d{10}$/.test(phone)
const nowIso = () => new Date().toISOString()
const businessDate = (iso = nowIso()) => iso.slice(0, 10)

const expireOldOrders = (db) => {
  const currentDate = businessDate()
  let changed = false
  db.orders.forEach((order) => {
    if (order.status === 'pending_payment_review' && order.businessDate < currentDate) {
      order.status = 'expired'
      order.expiredAt = nowIso()
      changed = true
    }
  })
  return changed
}

const cookieValue = (req, key) => {
  const header = req.headers.cookie || ''
  const cookie = header.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${key}=`))
  return cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : ''
}

const isAdmin = (req) => cookieValue(req, SESSION_COOKIE) === ADMIN_TOKEN

const assertAdmin = (req, res) => {
  if (!isAdmin(req)) {
    json(res, 401, { error: '请先登录后台' })
    return false
  }
  return true
}

const generatePickupCode = () => String(Math.floor(100000 + Math.random() * 900000))
const generateOrderId = () => `ORD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`

const validateImage = (value) => {
  if (!value) return false
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value)) return false
  return Buffer.byteLength(value, 'utf8') <= 1024 * 1024 * 3
}

const sendSmsCode = async (req, res) => {
  const body = await readBody(req)
  const phone = normalizePhone(body.phone)
  if (!isPhone(phone)) {
    json(res, 400, { error: '请输入正确的 11 位手机号' })
    return
  }

  const db = await readDb()
  const recent = db.smsCodes.find((item) => item.phone === phone && Date.now() - new Date(item.createdAt).getTime() < 60 * 1000)
  if (recent) {
    json(res, 429, { error: '验证码发送太频繁，请稍后再试' })
    return
  }

  const code = String(Math.floor(100000 + Math.random() * 900000))
  db.smsCodes = db.smsCodes
    .filter((item) => Date.now() - new Date(item.createdAt).getTime() < 10 * 60 * 1000)
    .concat({ phone, code, createdAt: nowIso(), used: false })
  await writeDb(db)

  console.log(`[SMS MOCK] ${phone}: ${code}`)
  json(res, 200, {
    ok: true,
    message: '验证码已生成',
    devCode: process.env.NODE_ENV === 'production' ? undefined : code,
  })
}

const createOrder = async (req, res) => {
  const body = await readBody(req)
  const db = await readDb()
  const ticket = db.tickets.find((item) => item.id === body.ticketId && item.enabled)
  const phone = normalizePhone(body.phone)
  const name = String(body.name || '').trim()
  const smsCode = String(body.smsCode || '').trim()
  const ageGroup = body.ageGroup === 'minor' ? 'minor' : 'adult'
  const guardianName = String(body.guardianName || '').trim()
  const guardianPhone = normalizePhone(body.guardianPhone)

  if (!ticket) return json(res, 400, { error: '请选择有效票种' })
  if (!name) return json(res, 400, { error: '请输入姓名' })
  if (!isPhone(phone)) return json(res, 400, { error: '请输入正确的手机号' })
  if (!body.waiverAccepted) return json(res, 400, { error: '请先同意安全须知与免责协议' })
  if (ageGroup === 'minor' && (!guardianName || !isPhone(guardianPhone) || !body.guardianConsent)) {
    return json(res, 400, { error: '未成年人需填写监护人信息并确认同意' })
  }
  if (ticket.requiresPaymentScreenshot && !validateImage(body.paymentScreenshot)) {
    return json(res, 400, { error: '请上传 3MB 以内的付款截图图片' })
  }

  const matchedCode = db.smsCodes.find((item) => item.phone === phone && item.code === smsCode && !item.used && Date.now() - new Date(item.createdAt).getTime() < 10 * 60 * 1000)
  if (!matchedCode) {
    return json(res, 400, { error: '短信验证码不正确或已过期' })
  }
  matchedCode.used = true

  const visitor = {
    id: crypto.randomUUID(),
    name,
    phone,
    ageGroup,
    guardianName: ageGroup === 'minor' ? guardianName : '',
    guardianPhone: ageGroup === 'minor' ? guardianPhone : '',
    createdAt: nowIso(),
  }
  const waiver = {
    id: crypto.randomUUID(),
    visitorId: visitor.id,
    version: '2026-05-v1',
    acceptedAt: nowIso(),
    ip: req.socket.remoteAddress,
    userAgent: req.headers['user-agent'] || '',
    guardianConsent: ageGroup === 'minor',
  }
  const order = {
    id: generateOrderId(),
    visitorId: visitor.id,
    waiverId: waiver.id,
    ticketId: ticket.id,
    ticketName: ticket.name,
    amount: ticket.price,
    phone,
    visitorName: name,
    pickupCode: generatePickupCode(),
    paymentScreenshot: ticket.requiresPaymentScreenshot ? body.paymentScreenshot : '',
    status: 'pending_payment_review',
    businessDate: businessDate(),
    note: '',
    createdAt: nowIso(),
  }

  db.visitors.push(visitor)
  db.waivers.push(waiver)
  db.orders.push(order)
  await writeDb(db)
  json(res, 201, { order })
}

const listAdminOrders = async (req, res, url) => {
  if (!assertAdmin(req, res)) return
  const db = await readDb()
  if (expireOldOrders(db)) await writeDb(db)
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase()
  const orders = db.orders
    .filter((order) => !q || order.phone.includes(q) || order.pickupCode.toLowerCase().includes(q))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 100)
  json(res, 200, { orders })
}

const getReport = async (req, res, url) => {
  if (!assertAdmin(req, res)) return
  const date = url.searchParams.get('date') || businessDate()
  const db = await readDb()
  if (expireOldOrders(db)) await writeDb(db)
  const orders = db.orders.filter((order) => order.businessDate === date)
  const checkedIn = orders.filter((order) => order.status === 'checked_in')
  const report = {
    date,
    totalOrders: orders.length,
    checkedInCount: checkedIn.length,
    rejectedCount: orders.filter((order) => order.status === 'rejected').length,
    pendingCount: orders.filter((order) => order.status === 'pending_payment_review').length,
    freeTicketCount: checkedIn.filter((order) => Number(order.amount) === 0).length,
    revenue: checkedIn.reduce((sum, order) => sum + Number(order.amount || 0), 0),
    revenueByTicket: checkedIn.reduce((acc, order) => {
      acc[order.ticketName] = (acc[order.ticketName] || 0) + Number(order.amount || 0)
      return acc
    }, {}),
  }
  json(res, 200, { report })
}

const updateOrder = async (req, res, orderId, action) => {
  if (!assertAdmin(req, res)) return
  const body = await readBody(req)
  const db = await readDb()
  if (expireOldOrders(db)) await writeDb(db)
  const order = db.orders.find((item) => item.id === orderId)
  if (!order) return json(res, 404, { error: '订单不存在' })
  if (order.status !== 'pending_payment_review') {
    return json(res, 409, { error: '该订单已经处理，不能重复核销' })
  }

  if (action === 'checkin') {
    order.status = 'checked_in'
    order.checkedInAt = nowIso()
    db.checkins.push({
      id: crypto.randomUUID(),
      orderId: order.id,
      staff: 'SUMMON staff',
      checkedInAt: order.checkedInAt,
      note: String(body.note || ''),
    })
  } else if (action === 'reject') {
    order.status = 'rejected'
    order.rejectedAt = nowIso()
    order.note = String(body.note || '付款或信息异常')
  } else {
    return notFound(res)
  }
  await writeDb(db)
  json(res, 200, { order })
}

const login = async (req, res) => {
  const body = await readBody(req)
  if (String(body.password || '') !== ADMIN_PASSWORD) {
    json(res, 401, { error: '后台密码错误' })
    return
  }
  json(res, 200, { staff: { name: 'SUMMON staff' } }, {
    'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(ADMIN_TOKEN)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`,
  })
}

const handleApi = async (req, res, url) => {
  try {
    if (req.method === 'GET' && url.pathname === '/api/tickets') {
      const db = await readDb()
      return json(res, 200, { tickets: db.tickets })
    }
    if (req.method === 'POST' && url.pathname === '/api/sms/send') return sendSmsCode(req, res)
    if (req.method === 'POST' && url.pathname === '/api/orders') return createOrder(req, res)
    if (req.method === 'POST' && url.pathname === '/api/admin/login') return login(req, res)
    if (req.method === 'GET' && url.pathname === '/api/admin/orders') return listAdminOrders(req, res, url)
    if (req.method === 'GET' && url.pathname === '/api/admin/report') return getReport(req, res, url)

    const match = url.pathname.match(/^\/api\/admin\/orders\/([^/]+)\/(checkin|reject)$/)
    if (req.method === 'POST' && match) {
      return updateOrder(req, res, decodeURIComponent(match[1]), match[2])
    }
    return notFound(res)
  } catch (error) {
    console.error(error)
    return json(res, 500, { error: error.message || '服务器错误' })
  }
}

const serveStatic = async (req, res, url) => {
  const distDir = path.join(__dirname, 'dist')
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, '')
  const filePath = path.join(distDir, safePath)
  if (!filePath.startsWith(distDir)) return notFound(res)

  try {
    const data = await fs.readFile(filePath)
    const ext = path.extname(filePath)
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.jpg': 'image/jpeg',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' })
    res.end(data)
  } catch {
    const fallback = await fs.readFile(path.join(distDir, 'index.html'))
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(fallback)
  }
}

await ensureDb()

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url)
  } else {
    serveStatic(req, res, url)
  }
}).listen(PORT, HOST, () => {
  console.log(`SUMMON system running at http://${HOST}:${PORT}`)
})
